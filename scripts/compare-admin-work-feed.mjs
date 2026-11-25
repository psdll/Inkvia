import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FIELDS = ["id", "status", "type", "thumbUrl"];

function normalizeMediaUrl(value) {
  return String(value || "").trim().replace(/\\/g, "/");
}

function legacyThumbUrl(row) {
  let meta = null;
  try { meta = row.templateData ? JSON.parse(row.templateData) : null; } catch {}
  const localPath = normalizeMediaUrl(row.localPath);
  const displayUrl = normalizeMediaUrl(
    meta?.outputDisplayUrl || meta?.outputPreviewUrl || meta?.outputPosterUrl || meta?.displayUrl || localPath,
  );
  return normalizeMediaUrl(meta?.outputThumbUrl)
    || normalizeMediaUrl(meta?.outputPreviewUrl)
    || normalizeMediaUrl(meta?.outputPosterUrl)
    || displayUrl
    || null;
}

export function compareProjectionPages(legacy, feed) {
  const differences = [];
  const length = Math.max(legacy.length, feed.length);
  for (let index = 0; index < length; index += 1) {
    const left = legacy[index] || null;
    const right = feed[index] || null;
    if (!left || !right) {
      differences.push({ index, field: "row", legacy: left, feed: right });
      continue;
    }
    for (const field of FIELDS) {
      if (left[field] !== right[field]) {
        differences.push({ index, field, legacy: left[field], feed: right[field] });
        break;
      }
    }
  }
  return differences;
}

async function listScopes(db) {
  const [users, authLinks, guestRows] = await Promise.all([
    db.user.findMany({ select: { id: true, username: true } }),
    db.generation.findMany({
      where: { authUserId: { not: null } },
      select: { authUserId: true, userId: true },
      distinct: ["authUserId", "userId"],
    }),
    db.generation.findMany({
      where: { authUserId: null },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  const authIds = new Set(users.map((user) => user.id));
  for (const row of authLinks) if (typeof row.authUserId === "number") authIds.add(row.authUserId);
  const usernameById = new Map(users.map((user) => [user.id, user.username]));
  const linkedByAuth = new Map();
  for (const row of authLinks) {
    if (typeof row.authUserId !== "number") continue;
    const linked = linkedByAuth.get(row.authUserId) || [];
    if (row.userId && !linked.includes(row.userId)) linked.push(row.userId);
    linkedByAuth.set(row.authUserId, linked);
  }
  const consumedGuests = new Set();
  const scopes = [...authIds].sort((a, b) => a - b).map((authUserId) => {
    const linkedUserIds = linkedByAuth.get(authUserId) || [String(authUserId)];
    linkedUserIds.forEach((userId) => consumedGuests.add(userId));
    return {
      adminKey: `auth:${authUserId}`,
      username: usernameById.get(authUserId) || null,
      where: {
        OR: [
          { authUserId },
          { authUserId: null, userId: { in: linkedUserIds } },
        ],
      },
    };
  });
  for (const row of guestRows) {
    const userId = String(row.userId || "").trim();
    if (!userId || consumedGuests.has(userId)) continue;
    scopes.push({ adminKey: `guest:${userId}`, username: null, where: { authUserId: null, userId } });
  }
  return scopes;
}

async function compareScope(db, scope, limit) {
  const [legacyRows, feedRows] = await Promise.all([
    db.generation.findMany({
      where: { AND: [scope.where, { type: { not: "import" } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, status: true, type: true, localPath: true, templateData: true },
    }),
    db.adminWorkFeed.findMany({
      where: { AND: [scope.where, { type: { not: "import" } }, { deletedAt: null }] },
      orderBy: [{ createdAt: "desc" }, { generationId: "desc" }],
      take: limit,
      select: { generationId: true, status: true, type: true, thumbUrl: true },
    }),
  ]);
  const legacy = legacyRows.map((row) => ({
    id: row.id,
    status: row.status,
    type: row.type,
    thumbUrl: legacyThumbUrl(row),
  }));
  const feed = feedRows.map((row) => ({
    id: row.generationId,
    status: row.status,
    type: row.type,
    thumbUrl: row.thumbUrl || null,
  }));
  return compareProjectionPages(legacy, feed);
}

async function main() {
  const expectedArg = process.argv.find((value) => value.startsWith("--expected-users="));
  const expectedUsers = expectedArg ? Number(expectedArg.split("=")[1]) : null;
  if (expectedUsers != null && (!Number.isSafeInteger(expectedUsers) || expectedUsers < 0)) {
    throw new Error("invalid --expected-users");
  }
  const db = createGuardedPrismaClient();
  try {
    const scopes = await listScopes(db);
    const mismatches = [];
    for (const scope of scopes) {
      const differences = await compareScope(db, scope, 40);
      if (differences.length) mismatches.push({
        adminKey: scope.adminKey,
        username: scope.username,
        firstDifference: differences[0],
        differenceCount: differences.length,
      });
    }
    const result = {
      checkedAt: new Date().toISOString(),
      checkedUsers: scopes.length,
      expectedUsers,
      differentUsers: mismatches.length,
      mismatches,
    };
    console.log(JSON.stringify(result, null, 2));
    if ((expectedUsers != null && scopes.length !== expectedUsers) || mismatches.length > 0) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
