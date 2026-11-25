import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import prisma from "@/lib/prisma";
import { getRuntimePolicy, prepareRuntime } from "./lib/runtime-isolation.cjs";
async function main() {
  await prepareRuntime();
  const policy = getRuntimePolicy();
  if (policy.profile !== "test") throw new Error("P0_REPORT_REQUIRES_TEST_RESOURCE");
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
  if (rows.some(row => !row.finished_at && !row.rolled_back_at)) throw new Error("MIGRATION_FAILED_OR_PENDING");
  const applied = rows.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name);
  const dir = path.resolve(".codex-artifacts/phase1-p0-20260906"); fs.mkdirSync(dir, { recursive: true });
  const appliedPath = path.join(dir, "actual-applied-migrations.txt");
  fs.writeFileSync(appliedPath, `${applied.join("\n")}\n`);
  const check = spawnSync(process.execPath, ["scripts/validate-migration-policy.mjs", "--applied", appliedPath], { encoding: "utf8" });
  if (check.status !== 0) throw new Error("MIGRATION_POLICY_REJECTED");
  const report = { resourceFingerprint: policy.fingerprint, appliedCount: applied.length, validator: JSON.parse(check.stdout) };
  fs.writeFileSync(path.join(dir, "migration-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ appliedCount: applied.length, errors: report.validator.errors, resourceFingerprint: policy.fingerprint }));
}
main().catch(error => { console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "P0_MIGRATION_REPORT_FAILED"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
