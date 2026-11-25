import nextEnv, * as nextEnvNamespace from "@next/env";
import { prepareRuntime, getRuntimePolicy } from "./lib/runtime-isolation.cjs";

async function main() {
  const modes = ["--inspect", "--dry-run", "--apply"].filter(value => process.argv.includes(value));
  if (modes.length !== 1) throw new Error("Use exactly one of --inspect, --dry-run, --apply; optionally --rotate");
  process.env.INKVIA_RUNTIME_PROFILE ||= "local";
  (nextEnv || nextEnvNamespace).loadEnvConfig(process.cwd(), process.env.INKVIA_RUNTIME_PROFILE === "local");
  await prepareRuntime();
  const policy = getRuntimePolicy();
  if (modes[0] === "--dry-run" && policy.profile === "production") throw new Error("DRY_RUN_REQUIRES_ISOLATED_TARGET");
  const [{ default: prisma }, credentials, passwords, cipher] = await Promise.all([
    import("@/lib/prisma"), import("@/lib/user-credentials"), import("@/lib/password"), import("@/lib/password-crypto"),
  ]);
  const rotate = process.argv.includes("--rotate");
  const userArgument = process.argv.find(value => value.startsWith("--user-id="));
  const onlyUserId = userArgument ? Number(userArgument.slice("--user-id=".length)) : undefined;
  if (onlyUserId !== undefined && (!Number.isSafeInteger(onlyUserId) || onlyUserId <= 0)) throw new Error("INVALID_USER_ID");
  const counts = { scanned: 0, plaintext: 0, encrypted: 0, hashOnly: 0, changed: 0, conflicts: 0, failed: 0 };
  let cursor = 0;
  try {
    for (;;) {
      const users = await prisma.user.findMany({ where: { id: { gt: cursor, ...(onlyUserId === undefined ? {} : { equals: onlyUserId }) } }, orderBy: { id: "asc" }, take: 50,
        select: { id: true, password: true, passwordCipher: true, credentialVersion: true, token: true } });
      if (!users.length) break;
      for (const user of users) {
        cursor = user.id; counts.scanned++;
        if (user.passwordCipher) counts.encrypted++;
        else if (passwords.isHashed(user.password) || /^\$2[aby]\$/.test(user.password)) { counts.hashOnly++; continue; }
        else counts.plaintext++;
        if (modes[0] === "--inspect" || (!!user.passwordCipher !== rotate)) continue;
        try {
          const plain = credentials.revealUserCredential(user);
          if (rotate) {
            const replacement = cipher.encryptPassword(plain, user.id, user.credentialVersion);
            if (cipher.decryptPassword(replacement, user.id, user.credentialVersion) !== plain) throw new Error();
            if (modes[0] === "--apply") {
              const result = await prisma.user.updateMany({ where: { id: user.id, credentialVersion: user.credentialVersion, passwordCipher: { equals: user.passwordCipher! } }, data: { passwordCipher: replacement } });
              if (result.count === 1) counts.changed++; else counts.conflicts++;
            }
          } else {
            const prepared = await credentials.preparePasswordVerification(plain);
            if (!(await passwords.verifyPassword(plain, prepared.hash))) throw new Error();
            if (modes[0] === "--apply") {
              await prisma.$transaction(tx => credentials.writeUserCredential(tx, { userId: user.id, expectedVersion: user.credentialVersion, prepared, token: user.token }));
              counts.changed++;
            }
          }
        } catch (error) {
          if (error instanceof cipher.CredentialError && error.code === "CREDENTIAL_VERSION_CONFLICT") counts.conflicts++;
          else counts.failed++;
        }
      }
    }
    console.log(JSON.stringify({ profile: policy.profile, fingerprint: policy.fingerprint, mode: modes[0], rotate, counts }));
    if (counts.failed) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "CREDENTIAL_MAINTENANCE_FAILED"); process.exitCode = 1; });
