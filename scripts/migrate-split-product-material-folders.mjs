import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import fs from "fs-extra";
import path from "path";
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const prisma = createGuardedPrismaClient();

function uploadsRoot() {
  const configured = String(process.env.UPLOADS_DIR || "").trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "public", "uploads");
}

const directoryMoves = [
  ["materials/shared", "products/shared"],
  ["materials/private", "products/private"],
  ["materials/thumbs", "products/thumbs"],
  ["materials/assets/originals", "material_library/originals"],
  ["materials/assets/thumbs", "material_library/thumbs"],
  ["materials/assets/previews", "material_library/previews"],
];

const productPathReplacements = [
  ["/uploads/materials/shared/", "/uploads/products/shared/"],
  ["uploads/materials/shared/", "uploads/products/shared/"],
  ["/uploads/materials/private/", "/uploads/products/private/"],
  ["uploads/materials/private/", "uploads/products/private/"],
  ["/uploads/materials/thumbs/", "/uploads/products/thumbs/"],
  ["uploads/materials/thumbs/", "uploads/products/thumbs/"],
];

const productRemoteRestoreReplacements = [
  ["/uploads/products/shared/", "/uploads/materials/shared/"],
  ["uploads/products/shared/", "uploads/materials/shared/"],
  ["/uploads/products/private/", "/uploads/materials/private/"],
  ["uploads/products/private/", "uploads/materials/private/"],
  ["/uploads/products/thumbs/", "/uploads/materials/thumbs/"],
  ["uploads/products/thumbs/", "uploads/materials/thumbs/"],
];

const materialPathReplacements = [
  ["/uploads/materials/assets/originals/", "/uploads/material_library/originals/"],
  ["uploads/materials/assets/originals/", "uploads/material_library/originals/"],
  ["/uploads/materials/assets/thumbs/", "/uploads/material_library/thumbs/"],
  ["uploads/materials/assets/thumbs/", "uploads/material_library/thumbs/"],
  ["/uploads/materials/assets/previews/", "/uploads/material_library/previews/"],
  ["uploads/materials/assets/previews/", "uploads/material_library/previews/"],
];

function rewriteValue(value, replacements) {
  let next = value;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }
  return next;
}

function hasLegacyValue(value, replacements) {
  return replacements.some(([from]) => String(value || "").includes(from));
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function hasOssConfig() {
  return Boolean(
    String(process.env.OSS_ENDPOINT || "").trim() &&
      String(process.env.OSS_BUCKET || "").trim() &&
      String(process.env.OSS_ACCESS_KEY_ID || "").trim() &&
      String(process.env.OSS_ACCESS_KEY_SECRET || "").trim()
  );
}

async function moveDirectory(fromRel, toRel) {
  const root = uploadsRoot();
  const from = path.join(root, fromRel);
  const to = path.join(root, toRel);
  if (!(await fs.pathExists(from))) {
    return { fromRel, toRel, skipped: true, reason: "missing source" };
  }
  if (!apply) return { fromRel, toRel, dryRun: true };

  await mergeMoveDirectory(from, to);
  return { fromRel, toRel, moved: true };
}

async function mergeMoveDirectory(from, to) {
  await fs.ensureDir(to);
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await mergeMoveDirectory(src, dest);
      await fs.remove(src);
      continue;
    }
    if (!(await fs.pathExists(dest))) {
      await fs.move(src, dest, { overwrite: false });
      continue;
    }
    const ext = path.extname(entry.name);
    const base = path.basename(entry.name, ext);
    const renamed = path.join(to, `${base}_migrated_${Date.now()}${ext}`);
    await fs.move(src, renamed, { overwrite: false });
  }
  await fs.remove(from);
}

async function rewriteRows({ model, modelName, fields, replacements, skipRemote = false, onlyRemote = false, operation = "rewrite" }) {
  const rows = await model.findMany({
    where: {
      OR: fields.flatMap((field) =>
        replacements.map(([from]) => ({
          [field]: { contains: from },
        }))
      ),
    },
    select: Object.fromEntries(["id", ...fields].map((field) => [field, true])),
  });

  let changed = 0;
  for (const row of rows) {
    const data = {};
    for (const field of fields) {
      const value = row[field];
      if (typeof value !== "string" || !hasLegacyValue(value, replacements)) continue;
      if (skipRemote && isRemoteUrl(value)) continue;
      if (onlyRemote && !isRemoteUrl(value)) continue;
      const next = rewriteValue(value, replacements);
      if (next !== value) data[field] = next;
    }
    if (!Object.keys(data).length) continue;
    changed += 1;
    if (apply) {
      await model.update({ where: { id: row.id }, data });
    }
  }

  return { modelName, operation, scanned: rows.length, changed };
}

try {
  const moved = [];
  for (const [from, to] of directoryMoves) {
    moved.push(await moveDirectory(from, to));
  }

  const rewritten = [
    await rewriteRows({
      model: prisma.mediaLibraryItem,
      modelName: "MediaLibraryItem",
      fields: ["fileUrl", "thumbnailUrl"],
      replacements: productPathReplacements,
      skipRemote: !hasOssConfig(),
    }),
    await rewriteRows({
      model: prisma.materialAsset,
      modelName: "MaterialAsset",
      fields: ["imageUrl", "thumbnailUrl", "previewUrl"],
      replacements: materialPathReplacements,
    }),
  ];

  const remoteRestored = hasOssConfig()
    ? []
    : [
        await rewriteRows({
          model: prisma.mediaLibraryItem,
          modelName: "MediaLibraryItem",
          fields: ["fileUrl", "thumbnailUrl"],
          replacements: productRemoteRestoreReplacements,
          onlyRemote: true,
          operation: "restore-remote-without-oss-config",
        }),
      ];

  console.log(JSON.stringify({ apply, uploadsRoot: uploadsRoot(), ossConfigured: hasOssConfig(), moved, rewritten, remoteRestored }, null, 2));
} finally {
  await prisma.$disconnect();
}
