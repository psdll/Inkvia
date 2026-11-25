import { parseRoleSkillPublicId } from "@/lib/role-skills/contracts";

/** Shared slash syntax; legacy names are resolved by the existing authorized catalog. */
export function parseCreativeSkillCommand(text: string) {
  const match = text.match(/^\s*\/skill:([^\s]+)(?:\s+([\s\S]*))?$/);
  return match ? { skillId: match[1], request: match[2] ?? "", prefixLength: text.length - (match[2]?.length ?? 0) } : undefined;
}

/** Classify only the user's request, preserving every original UTF-16 source offset. */
export function maskCanonicalCreativeSkillCommand(text: string) {
  const command = parseCreativeSkillCommand(text);
  if (!command) return text;
  try { parseRoleSkillPublicId(command.skillId); } catch { return text; }
  return text.slice(0, command.prefixLength).replace(/[^\n]/g, " ") + text.slice(command.prefixLength);
}
