#!/usr/bin/env node
import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";

import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";
import JSZip from "jszip";

const CONFIRM_RESET = "RESET_CANVAS_V2";
const CONFIRM_RESTORE = "RESTORE_CANVAS_V2";

function usage() {
  console.log(`Usage:
  node scripts/canvas-v2-archive.mjs archive --output <file.zip> [--database-url <url>]
  node scripts/canvas-v2-archive.mjs verify --archive <file.zip>
  node scripts/canvas-v2-archive.mjs reset --archive <file.zip> --archive-id <id> --confirm ${CONFIRM_RESET} [--database-url <url>]
  node scripts/canvas-v2-archive.mjs restore --archive <file.zip> --archive-id <id> --confirm ${CONFIRM_RESTORE} [--database-url <url>]

reset and restore refuse to run without the exact archive id and confirmation token.`);
}

function args(argv) {
  const values = { command: argv[2] || "help" };
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    values[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function payloadText(payload) {
  return JSON.stringify(payload);
}

function collectReferences(value, result = new Set()) {
  if (typeof value === "string") {
    if (/^(?:https?:\/\/|\/uploads\/|\/api\/uploads\/)/i.test(value)) result.add(value);
    return result;
  }
  if (Array.isArray(value)) for (const item of value) collectReferences(item, result);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectReferences(item, result);
  return result;
}

async function loadArchive(file) {
  const bytes = await readFile(file);
  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.file("manifest.json");
  const payloadEntry = zip.file("payload.json");
  if (!manifestEntry || !payloadEntry) throw new Error("Archive is missing manifest.json or payload.json");
  const manifest = JSON.parse(await manifestEntry.async("string"));
  const text = await payloadEntry.async("string");
  if (sha256(text) !== manifest.payloadSha256) throw new Error("Archive payload checksum mismatch");
  const payload = JSON.parse(text);
  if (payload.canvases.length !== manifest.counts.canvases || payload.projects.length !== manifest.counts.projects || payload.runs.length !== manifest.counts.runs) throw new Error("Archive record count mismatch");
  return { bytes, manifest, payload };
}

function prismaFor(databaseUrl) {
  const url = databaseUrl || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL or --database-url is required");
  return createGuardedPrismaClient({ datasources: { db: { url } } });
}

async function archive(command) {
  if (!command.output) throw new Error("--output is required");
  const prisma = prismaFor(command["database-url"]);
  try {
    const [projects, canvases, runs] = await Promise.all([
      prisma.canvasProject.findMany({ orderBy: { id: "asc" } }),
      prisma.canvas.findMany({ orderBy: { id: "asc" } }),
      prisma.canvasRun.findMany({ orderBy: { id: "asc" } }),
    ]);
    const payload = { projects, canvases, runs };
    const text = payloadText(payload);
    const references = [...collectReferences(canvases)].sort();
    const manifest = {
      archiveId: randomUUID(),
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      counts: { users: new Set(canvases.map((item) => item.authUserId)).size, projects: projects.length, canvases: canvases.length, runs: runs.length, references: references.length },
      payloadSha256: sha256(text),
      references,
    };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("payload.json", text);
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    await writeFile(command.output, bytes);
    const archiveSha256 = sha256(bytes);
    await writeFile(`${command.output}.sha256`, `${archiveSha256}  ${path.basename(command.output)}\n`, "utf8");
    console.log(JSON.stringify({ success: true, file: path.resolve(command.output), archiveSha256, ...manifest }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function verify(command) {
  if (!command.archive) throw new Error("--archive is required");
  const loaded = await loadArchive(command.archive);
  const archiveSha256 = sha256(loaded.bytes);
  const sidecar = await readFile(`${command.archive}.sha256`, "utf8").catch(() => "");
  if (sidecar && !sidecar.trim().startsWith(archiveSha256)) throw new Error("Archive file checksum mismatch");
  console.log(JSON.stringify({ success: true, archiveSha256, ...loaded.manifest }, null, 2));
  return loaded;
}

async function reset(command) {
  if (command.confirm !== CONFIRM_RESET) throw new Error(`--confirm ${CONFIRM_RESET} is required`);
  const loaded = await loadArchive(command.archive);
  if (command["archive-id"] !== loaded.manifest.archiveId) throw new Error("--archive-id does not match the archive manifest");
  const prisma = prismaFor(command["database-url"]);
  try {
    const [projects, canvases, runs] = await Promise.all([
      prisma.canvasProject.findMany({ orderBy: { id: "asc" } }),
      prisma.canvas.findMany({ orderBy: { id: "asc" } }),
      prisma.canvasRun.findMany({ orderBy: { id: "asc" } }),
    ]);
    const currentPayload = { projects, canvases, runs };
    if (sha256(payloadText(currentPayload)) !== loaded.manifest.payloadSha256) throw new Error("Database contents changed after archive; create a new archive before reset");
    await prisma.$transaction([prisma.canvasRun.deleteMany(), prisma.canvas.deleteMany(), prisma.canvasProject.deleteMany()]);
    console.log(JSON.stringify({ success: true, archiveId: loaded.manifest.archiveId, deleted: { projects: projects.length, canvases: canvases.length, runs: runs.length } }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function restoreDates(row) {
  const result = { ...row };
  for (const key of ["createdAt", "updatedAt", "deletedAt", "startedAt", "finishedAt"]) if (result[key]) result[key] = new Date(result[key]);
  return result;
}

async function restore(command) {
  if (command.confirm !== CONFIRM_RESTORE) throw new Error(`--confirm ${CONFIRM_RESTORE} is required`);
  const loaded = await loadArchive(command.archive);
  if (command["archive-id"] !== loaded.manifest.archiveId) throw new Error("--archive-id does not match the archive manifest");
  const prisma = prismaFor(command["database-url"]);
  try {
    const [projects, canvases, runs] = await Promise.all([prisma.canvasProject.count(), prisma.canvas.count(), prisma.canvasRun.count()]);
    if (projects || canvases || runs) throw new Error("Restore requires empty CanvasProject, Canvas, and CanvasRun tables");
    await prisma.$transaction(async (tx) => {
      if (loaded.payload.projects.length) await tx.canvasProject.createMany({ data: loaded.payload.projects.map(restoreDates) });
      if (loaded.payload.canvases.length) await tx.canvas.createMany({ data: loaded.payload.canvases.map(restoreDates) });
      if (loaded.payload.runs.length) await tx.canvasRun.createMany({ data: loaded.payload.runs.map(restoreDates) });
      await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"CanvasProject"','id'), COALESCE((SELECT MAX(id) FROM "CanvasProject"), 1), true)`);
      await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Canvas"','id'), COALESCE((SELECT MAX(id) FROM "Canvas"), 1), true)`);
      await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"CanvasRun"','id'), COALESCE((SELECT MAX(id) FROM "CanvasRun"), 1), true)`);
    });
    const restored = { projects: await prisma.canvasProject.count(), canvases: await prisma.canvas.count(), runs: await prisma.canvasRun.count() };
    if (restored.projects !== loaded.manifest.counts.projects || restored.canvases !== loaded.manifest.counts.canvases || restored.runs !== loaded.manifest.counts.runs) throw new Error("Restored counts do not match archive manifest");
    console.log(JSON.stringify({ success: true, archiveId: loaded.manifest.archiveId, restored }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const command = args(process.argv);
try {
  if (command.command === "archive") await archive(command);
  else if (command.command === "verify") await verify(command);
  else if (command.command === "reset") await reset(command);
  else if (command.command === "restore") await restore(command);
  else { usage(); process.exitCode = command.command === "help" ? 0 : 1; }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
