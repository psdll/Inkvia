import path from "node:path";
import { resolveProjectRootDir } from "@/lib/public-path";

export function getImportsDir(): string {
  const configured = String(process.env.IMPORTS_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return path.join(resolveProjectRootDir(), ".imports");
}

