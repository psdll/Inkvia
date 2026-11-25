import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

const accounts = Prisma.sql`SELECT w.name, w."createdAt", 0 AS priority FROM "WhitelistName" w
  UNION ALL SELECT u.username AS name, u."createdAt", 1 AS priority FROM "User" u
  WHERE NOT EXISTS (SELECT 1 FROM "WhitelistName" w WHERE w.name = u.username)`;

export async function getAdminAccountPage(input: { q?: string; page?: number; pageSize?: number }, db = prisma) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(Number(input.pageSize) || 50)));
  const q = String(input.q || '').trim().slice(0, 100);
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await db.$queryRaw<Array<{ name: string; total: bigint }>>(Prisma.sql`
    WITH accounts AS (${accounts})
    SELECT name, COUNT(*) OVER() AS total FROM accounts
    WHERE ${!q} OR name ILIKE ${pattern}
    ORDER BY priority, "createdAt" DESC, name ASC LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}
  `);
  const count = !rows.length && page > 1
    ? await db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`WITH accounts AS (${accounts})
        SELECT COUNT(*) AS total FROM accounts WHERE ${!q} OR name ILIKE ${pattern}`)
    : rows;
  return { names: rows.map(row => row.name), total: Number(count[0]?.total || 0), page, pageSize };
}

export type AdminAccountSummary = {
  accounts: number; whitelist: number; registered: number; unregistered: number;
  selfReset: number; materialUpload: number; inspirationUpload: number; generations: number;
};
let summaryCache: { value: AdminAccountSummary; at: number } | null = null;
let summaryRequest: Promise<AdminAccountSummary> | null = null;
let summaryEpoch = 0;
export function invalidateAdminAccountSummary() { summaryEpoch++; summaryCache = null; summaryRequest = null; }
export async function getAdminAccountSummary() {
  if (summaryCache && Date.now()-summaryCache.at < 15000) return summaryCache.value;
  if (summaryRequest) return summaryRequest;
  const epoch = summaryEpoch;
  const request = (async () => {
    const [row] = await prisma.$queryRaw<AdminAccountSummary[]>(Prisma.sql`
      WITH accounts AS (${accounts})
      SELECT (SELECT COUNT(*)::int FROM accounts) AS accounts,
        (SELECT COUNT(*)::int FROM "WhitelistName") AS whitelist,
        (SELECT COUNT(*)::int FROM "User") AS registered,
        (SELECT COUNT(*)::int FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.username=a.name)) AS unregistered,
        (SELECT COUNT(*)::int FROM "User" u JOIN "AppSetting" s ON s.key='auth_password_reset_allowed:'||u.username AND s.value='1') AS "selfReset",
        (SELECT COUNT(*)::int FROM accounts a JOIN "AppSetting" s ON s.key='material_upload_allowed:'||a.name AND s.value='1') AS "materialUpload",
        (SELECT COUNT(*)::int FROM accounts a JOIN "AppSetting" s ON s.key='inspiration_template_upload_allowed:'||a.name AND s.value='1') AS "inspirationUpload",
        (SELECT COUNT(*)::int FROM "Generation" g JOIN "User" u ON u.id=g."authUserId") AS generations
    `);
    if (epoch === summaryEpoch) summaryCache={value:row,at:Date.now()};
    return row;
  })();
  summaryRequest=request;
  try { return await request; } finally { if(summaryRequest===request) summaryRequest=null; }
}
