import "server-only";
import { randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/password";
import { assertPasswordCipherReady, encryptPassword } from "@/lib/password-crypto";
import { registerSchema } from "@/lib/validation/auth";
import type { MigrationCredential } from "@/lib/admin/user-migration-package";
import type { ImportAccountOptions, ImportNeedsInput } from "@/lib/admin/user-migration-contracts";

export class ImportAccountInputError extends Error {
  constructor(message: string, public readonly needsInput: ImportNeedsInput) {
    super(message);
    this.name = "ImportAccountInputError";
  }
}

type AccountClient = {
  user: {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
  $queryRawUnsafe: (...args: any[]) => Promise<any>;
};
export type ImportedAccountPlan = {
  sourceUserId: number;
  targetUserId: number;
  username: string;
  created: boolean;
  credential?: MigrationCredential;
  generatedPassword?: boolean;
};

export async function planImportedAccount(
  client: AccountClient,
  archivedUser: Record<string, any>,
  options: ImportAccountOptions,
  credential?: MigrationCredential,
): Promise<ImportedAccountPlan> {
  const sourceUserId = Number(archivedUser.id);
  const username = typeof archivedUser.username === "string" ? archivedUser.username.trim() : "";
  if (!Number.isSafeInteger(sourceUserId) || sourceUserId <= 0 || !username || username.length > 64) {
    throw new Error("user.json 数据无效，缺少有效的 id 或 username");
  }
  const sameName = await client.user.findUnique({ where: { username }, select: { id: true } });
  if (sameName) {
    if (options.mergeTargetUserId !== undefined && options.mergeTargetUserId !== Number(sameName.id)) {
      throw new Error("目标账号已发生变化，请重新检查后导入");
    }
    return { sourceUserId, targetUserId: Number(sameName.id), username, created: false };
  }
  if (options.mergeTargetUserId !== undefined) throw new Error("目标账号已发生变化，请重新检查后导入");
  // Ordinary V1 credentials are ignored. Missing historical passwords are generated
  // locally and stored using the existing admin password-management mechanism.
  const generatedPassword = !credential && !options.newPassword;
  if (!credential) {
    const password = options.newPassword ?? randomBytes(18).toString("base64url");
    const parsed = registerSchema.safeParse({ username, password });
    if (!parsed.success) throw new Error("账号信息或新密码无效");
    assertPasswordCipherReady();
    credential = { version: 1, passwordHash: await hashPassword(password), recoverablePassword: password };
  }
  if (credential.recoverablePassword !== undefined) assertPasswordCipherReady();
  // Reserve through PostgreSQL's own sequence: MAX(id)+1 is unsafe beside live registrations.
  const rows = await client.$queryRawUnsafe(
    `SELECT nextval(pg_get_serial_sequence('"User"', 'id')) AS id`,
  );
  const targetUserId = Number(rows[0]?.id);
  if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0 || targetUserId > 2147483647) {
    throw new Error("无法分配目标账号 ID");
  }
  return { sourceUserId, targetUserId, username, created: true, credential, generatedPassword };
}

export async function restoreImportedAccount(client: AccountClient, plan: ImportedAccountPlan) {
  const existing = await client.user.findUnique({ where: { username: plan.username }, select: { id: true } });
  if (!plan.created) {
    if (!existing || Number(existing.id) !== plan.targetUserId) throw new Error("目标账号已发生变化，请重新检查后导入");
  } else {
    if (existing || !plan.credential) throw new Error("目标账号已发生变化，请重新检查后导入");
    const passwordCipher = plan.credential.recoverablePassword === undefined
      ? undefined
      : encryptPassword(plan.credential.recoverablePassword, plan.targetUserId, 1);
    await client.user.create({ data: {
      id: plan.targetUserId,
      username: plan.username,
      password: plan.credential.passwordHash,
      passwordCipher,
      credentialVersion: 1,
      token: null,
    } });
  }
  return { sourceUserId: plan.sourceUserId, targetUserId: plan.targetUserId, username: plan.username, created: plan.created };
}
