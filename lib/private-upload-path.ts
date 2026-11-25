export function isPrivateUploadPath(relative: string) {
  const normalized = String(relative || "").replaceAll("\\", "/").split("/").filter(part => part && part !== ".").map(part => part.replace(/[. ]+$/, "").toLowerCase()).join("/");
  return normalized === ".agent-memory"
    || normalized === "canvas-library"
    || normalized.startsWith("canvas-library/")
    || normalized.startsWith(".agent-memory/")
    || /^role_skill_covers\/(?:system|users\/[1-9]\d*)\/workspaces\//.test(normalized);
}
