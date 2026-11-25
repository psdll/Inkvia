import { z } from "zod";

// 鉴权相关接口的入参 schema。

const username = z
  .string({ required_error: "用户名不能为空" })
  .trim()
  .min(1, "用户名不能为空")
  .max(64, "用户名过长");

const password = z
  .string({ required_error: "密码不能为空" })
  .min(1, "密码不能为空")
  .max(256, "密码过长");

/** POST /api/auth/login */
export const loginSchema = z.object({
  username,
  password,
});

/** POST /api/auth/register */
export const registerSchema = z.object({
  username,
  password: password.min(4, "密码至少4个字符"),
});

/** POST /api/auth/password-reset */
export const passwordResetSchema = z.object({
  username,
  newPassword: password.min(4, "密码至少4个字符"),
});

/** POST /api/admin/login */
export const adminLoginSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  password: z.string().min(1, "请输入密码").max(256),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
