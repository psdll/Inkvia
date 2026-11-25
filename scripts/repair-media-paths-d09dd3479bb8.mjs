import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import { PrismaClient } from "@prisma/client";

function normalizeMediaUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text === "null" || text === "undefined") return "";
  const s = text.replaceAll("\\", "/");
  if (s.startsWith("/uploads/")) return s;
  if (s.startsWith("uploads/")) return `/${s}`;
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;
  try {
    const u = new URL(s);
    if (u.pathname.startsWith("/uploads/")) return `${u.pathname}${u.search}${u.hash}`;
    return u.toString();
  } catch {
    const idx = s.indexOf("/uploads/");
    if (idx >= 0) return s.slice(idx);
    return s;
  }
}

const prisma = createGuardedPrismaClient();

async function main() {
  const rows = await prisma.generation.findMany({
    where: { localPath: { not: null } },
    select: { id: true, localPath: true }
  });
  let changed = 0;
  for (const row of rows) {
    const before = String(row.localPath || "");
    const after = normalizeMediaUrl(before);
    if (!after || before === after) continue;
    await prisma.generation.update({
      where: { id: row.id },
      data: { localPath: after }
    });
    changed++;
  }
  console.log(`checked=${rows.length}`);
  console.log(`updated=${changed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
