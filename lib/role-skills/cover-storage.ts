import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";
import prisma from "@/lib/prisma";
import { resolvePublicPath } from "@/lib/public-path";
import {
  ROLE_SKILL_SYSTEM_COVERS_FOLDER,
  roleSkillUserCoversFolder,
} from "@/lib/upload-buckets";
import { validateUploadFile } from "@/lib/upload-validation";

export const ROLE_SKILL_COVER_MAX_BYTES = 10 * 1024 * 1024;

const UUID_WEBP = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.webp";
const SYSTEM_COVER_PATTERN = new RegExp(`^/uploads/role_skill_covers/system/${UUID_WEBP}$`, "i");
const PERSONAL_COVER_PATTERN = new RegExp(`^/uploads/role_skill_covers/users/([1-9]\\d*)/${UUID_WEBP}$`, "i");

export class RoleSkillCoverError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "RoleSkillCoverError";
  }
}

function normalizeCoverUrl(value: unknown) {
  const url = String(value || "").trim().replaceAll("\\", "/");
  if (!url || url.includes("..") || /[?#]/.test(url)) {
    throw new RoleSkillCoverError("技能封面地址无效");
  }
  return url;
}

export function requireSystemRoleSkillCoverUrl(value: unknown) {
  const url = normalizeCoverUrl(value);
  if (!SYSTEM_COVER_PATTERN.test(url)) {
    throw new RoleSkillCoverError("系统技能封面地址无效");
  }
  return url;
}

export function requirePersonalRoleSkillCoverUrl(
  value: unknown,
  authUserId: number,
) {
  const url = normalizeCoverUrl(value);
  const match = PERSONAL_COVER_PATTERN.exec(url);
  if (!match || Number(match[1]) !== authUserId) {
    throw new RoleSkillCoverError("个人技能封面不属于当前账号", 403);
  }
  return url;
}

export async function saveRoleSkillCover(input: {
  file: File;
  scope: "system" | "personal";
  authUserId?: number;
}) {
  const validation = await validateUploadFile(
    input.file,
    ["image"],
    { image: ROLE_SKILL_COVER_MAX_BYTES },
  );
  if (!validation.ok) {
    throw new RoleSkillCoverError(validation.error || "技能封面校验失败");
  }
  if (
    input.scope === "personal"
    && (!Number.isInteger(input.authUserId) || Number(input.authUserId) < 1)
  ) {
    throw new RoleSkillCoverError("个人技能封面账号无效", 403);
  }

  let output: Buffer;
  try {
    const source = Buffer.from(await input.file.arrayBuffer());
    output = await sharp(source, { animated: false, failOn: "error" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();
  } catch {
    throw new RoleSkillCoverError("技能封面无法解码或内容损坏");
  }

  const folder = input.scope === "system"
    ? ROLE_SKILL_SYSTEM_COVERS_FOLDER
    : roleSkillUserCoversFolder(Number(input.authUserId));
  const fileName = `${randomUUID()}.webp`;
  const outputDir = path.resolve(resolvePublicPath("uploads", ...folder.split("/")));
  const outputPath = path.resolve(outputDir, fileName);
  if (path.dirname(outputPath) !== outputDir) {
    throw new RoleSkillCoverError("技能封面存储路径无效");
  }
  await fs.ensureDir(outputDir);
  await fs.writeFile(outputPath, output);
  return `/uploads/${folder}/${fileName}`;
}

function requireControlledCoverUrl(value: unknown) {
  const url = normalizeCoverUrl(value);
  if (!SYSTEM_COVER_PATTERN.test(url) && !PERSONAL_COVER_PATTERN.test(url)) {
    throw new RoleSkillCoverError("技能封面地址不在受控目录中");
  }
  return url;
}

export async function deleteRoleSkillCoverIfUnreferenced(value: unknown) {
  const coverUrl = requireControlledCoverUrl(value);
  const db = prisma as any;
  const [systemReferences, personalReferences] = await Promise.all([
    db.systemRoleSkill.count({ where: { coverUrl } }),
    db.userRoleSkill.count({ where: { coverUrl } }),
  ]);
  if (systemReferences > 0 || personalReferences > 0) {
    return { deleted: false, referenced: true };
  }
  const result = await deleteStoredMediaRefs([coverUrl], { localOnly: true });
  return {
    deleted: result.deletedLocalFiles > 0,
    referenced: false,
  };
}
