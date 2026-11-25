export type ImportNeedsInput = {
  kind: "passphrase" | "new_password" | "merge";
  username?: string;
  targetUserId?: number;
};

export type ImportAccountOptions = {
  migrationPassphrase?: string;
  newPassword?: string;
  mergeTargetUserId?: number;
};

export function parseImportAccountOptions(input: unknown): ImportAccountOptions {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("导入选项格式无效");
  }
  const value = input as Record<string, unknown>;
  const result: ImportAccountOptions = {};
  if (value.migrationPassphrase !== undefined) {
    if (typeof value.migrationPassphrase !== "string" || value.migrationPassphrase.length < 12 || value.migrationPassphrase.length > 256) {
      throw new Error("迁移口令长度必须为 12–256 个字符");
    }
    result.migrationPassphrase = value.migrationPassphrase;
  }
  if (value.newPassword !== undefined) {
    if (typeof value.newPassword !== "string" || value.newPassword.length < 4 || value.newPassword.length > 256) {
      throw new Error("新密码长度必须为 4–256 个字符");
    }
    result.newPassword = value.newPassword;
  }
  if (value.mergeTargetUserId !== undefined) {
    if (typeof value.mergeTargetUserId !== "number" || !Number.isSafeInteger(value.mergeTargetUserId) || value.mergeTargetUserId <= 0) {
      throw new Error("目标用户 ID 无效");
    }
    result.mergeTargetUserId = value.mergeTargetUserId;
  }
  return result;
}
