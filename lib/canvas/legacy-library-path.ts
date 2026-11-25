import path from "node:path";
import { existsSync } from "node:fs";

// Only pre-migration public UUID media/workflows retain their old URLs.
export function legacyLibraryFile(uploadsRoot: string, relative: string): string | null {
  const match = /^canvas-library\/([1-9]\d*)\/([a-f0-9-]{36}\.(?:png|jpe?g|webp|gif|bmp|avif|tiff|mp4|webm|mov|mkv|mp3|wav|aac|ogg|flac|m4a|canvas\.json))$/i.exec(relative);
  if (!match) return null;
  const file = path.join(uploadsRoot, "canvas-library-legacy", match[1], match[2]);
  return existsSync(file) ? file : null;
}
