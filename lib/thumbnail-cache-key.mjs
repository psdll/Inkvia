import crypto from "node:crypto";
import path from "node:path";

export function getThumbnailCacheKey(input) {
  return crypto
    .createHash("sha1")
    .update(path.resolve(input.sourcePath))
    .update(String(input.sourceMtimeMs))
    .update(`w${Math.max(1, Math.floor(input.width))}`)
    .update(`q${Math.max(1, Math.floor(input.quality ?? 88))}`)
    .digest("hex");
}
