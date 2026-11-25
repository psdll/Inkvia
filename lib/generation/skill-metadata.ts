export type GenerationSkillSnapshot = {
  id?: string;
  name: string;
  revision?: number;
};

function cleanString(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function skillObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try {
      return skillObject(JSON.parse(text));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeGenerationSkillSnapshot(
  value: unknown,
): GenerationSkillSnapshot | null {
  const skill = skillObject(value);
  if (!skill) return null;
  const name = cleanString(skill.name, 64);
  if (!name) return null;
  const id = cleanString(skill.id || skill.publicId, 128);
  const revision = Number(skill.revision);
  return {
    ...(id ? { id } : {}),
    name,
    ...(Number.isSafeInteger(revision) && revision >= 0 ? { revision } : {}),
  };
}

export function generationSkillMetadata(value: unknown) {
  const skill = normalizeGenerationSkillSnapshot(value);
  return skill ? { skill } : {};
}

export function getGenerationSkillName(params: unknown) {
  const source = skillObject(params);
  if (!source) return "";
  const snapshot = normalizeGenerationSkillSnapshot(source.skill);
  if (snapshot) return snapshot.name;
  return cleanString(source.skillName, 64);
}

export function getGenerationSkillDetailEntry(params: unknown) {
  const value = getGenerationSkillName(params);
  return value ? { label: "使用技能", value } : null;
}
