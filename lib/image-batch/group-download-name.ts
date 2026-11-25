import { IMAGE_BATCH_LIMITS } from "@/lib/image-batch/contracts";

const CONTROL_CHARACTER = /[\u0000-\u001f]/;
const FORBIDDEN_FILENAME_CHARACTER = /[\\/:*?"<>|]/;
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function validateBatchGroupDownloadName(value: unknown): string | null {
  const name = String(value ?? "");
  if (!name.trim()) return "请输入分组名称";
  if (name !== name.trim()) return "分组名称首尾不能包含空白字符";
  if (name.length > IMAGE_BATCH_LIMITS.maxNameLength) {
    return `分组名称不能超过 ${IMAGE_BATCH_LIMITS.maxNameLength} 个字符`;
  }
  if (CONTROL_CHARACTER.test(name)) return "分组名称不能包含控制字符";
  if (FORBIDDEN_FILENAME_CHARACTER.test(name)) {
    return '分组名称不能包含 \\ / : * ? " < > |';
  }
  if (name === "." || name === ".." || name.endsWith(".")) {
    return "分组名称不能以句点结尾";
  }
  if (WINDOWS_RESERVED_NAME.test(name)) {
    return "分组名称不能使用 Windows 保留名称";
  }
  return null;
}

export function batchGroupArchiveName(groupName: string) {
  return `${groupName}.zip`;
}

export function batchGroupOutputName(
  groupName: string,
  index: number,
  extension: string,
) {
  const normalizedExtension = extension.startsWith(".")
    ? extension
    : `.${extension}`;
  return `${groupName}${index}${normalizedExtension}`;
}
