export function getThumbnailCacheKey(input: {
  sourcePath: string;
  sourceMtimeMs: number;
  width: number;
  quality?: number;
}): string;
