const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GenerationInputManifestItem =
  | { position: number; source: "tool_media"; mediaId: string }
  | { position: number; source: "legacy_path"; path: string };

export type GenerationInputManifestV1 = {
  version: 1;
  items: GenerationInputManifestItem[];
};

export type GenerationInputSubmissionItem = {
  mediaId?: unknown;
  url?: unknown;
  file?: unknown;
  uploadError?: unknown;
};

export class GenerationInputManifestError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "GenerationInputManifestError";
  }
}

function normalizeUuid(value: unknown) {
  const normalized = String(value || "").trim();
  return UUID_PATTERN.test(normalized) ? normalized : "";
}

function isUnboundToolMediaPath(path: string) {
  if (
    path.startsWith("/uploads/tool_inputs/") ||
    path.startsWith("uploads/tool_inputs/")
  ) {
    return true;
  }
  try {
    return new URL(path).pathname.startsWith("/uploads/tool_inputs/");
  } catch {
    return false;
  }
}

function arraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function buildGenerationInputSubmission(
  items: GenerationInputSubmissionItem[],
) {
  const manifestItems: GenerationInputManifestItem[] = [];
  const toolMediaIds: string[] = [];
  const legacyPaths: string[] = [];

  items.forEach((item, position) => {
    if (String(item.uploadError || "").trim()) {
      throw new GenerationInputManifestError(
        `第 ${position + 1} 个素材上传失败，请替换或删除后重试`,
      );
    }

    const rawMediaId = String(item.mediaId || "").trim();
    const mediaId = normalizeUuid(rawMediaId);
    if (rawMediaId && !mediaId) {
      throw new GenerationInputManifestError(
        `第 ${position + 1} 个素材标识无效，请重新添加`,
      );
    }
    if (mediaId) {
      toolMediaIds.push(mediaId);
      manifestItems.push({ position, source: "tool_media", mediaId });
      return;
    }

    const path = String(item.url || "").trim();
    if (!path || item.file || isUnboundToolMediaPath(path)) {
      throw new GenerationInputManifestError(
        `第 ${position + 1} 个素材尚未就绪，请重新上传`,
      );
    }
    legacyPaths.push(path);
    manifestItems.push({ position, source: "legacy_path", path });
  });

  return {
    manifest: { version: 1 as const, items: manifestItems },
    toolMediaIds,
    legacyPaths,
  };
}

export function parseGenerationInputManifest(
  value: unknown,
): GenerationInputManifestV1 | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new GenerationInputManifestError("素材顺序信息格式不正确");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new GenerationInputManifestError("素材顺序信息格式不正确");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new GenerationInputManifestError("素材顺序信息格式不正确");
  }
  const candidate = parsed as { version?: unknown; items?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.items)) {
    throw new GenerationInputManifestError("素材顺序信息版本不受支持");
  }

  const items = candidate.items.map((rawItem, position) => {
    if (!rawItem || typeof rawItem !== "object") {
      throw new GenerationInputManifestError(
        `第 ${position + 1} 个素材顺序信息格式不正确`,
      );
    }
    const item = rawItem as {
      position?: unknown;
      source?: unknown;
      mediaId?: unknown;
      path?: unknown;
    };
    if (item.position !== position) {
      throw new GenerationInputManifestError("素材位置信息必须连续且不能重复");
    }
    if (item.source === "tool_media") {
      const mediaId = normalizeUuid(item.mediaId);
      if (!mediaId) {
        throw new GenerationInputManifestError(
          `第 ${position + 1} 个素材标识无效`,
        );
      }
      return { position, source: "tool_media" as const, mediaId };
    }
    if (item.source === "legacy_path") {
      const path = String(item.path || "").trim();
      if (!path) {
        throw new GenerationInputManifestError(
          `第 ${position + 1} 个素材路径无效`,
        );
      }
      return { position, source: "legacy_path" as const, path };
    }
    throw new GenerationInputManifestError(
      `第 ${position + 1} 个素材来源无效`,
    );
  });

  return { version: 1, items };
}

export function assertGenerationInputManifestMatches(
  manifest: GenerationInputManifestV1 | null | undefined,
  toolMediaIds: string[],
  legacyPaths: string[],
) {
  if (!manifest) return;
  const manifestToolMediaIds = manifest.items.flatMap((item) =>
    item.source === "tool_media" ? [item.mediaId] : [],
  );
  const manifestLegacyPaths = manifest.items.flatMap((item) =>
    item.source === "legacy_path" ? [item.path] : [],
  );
  if (
    !arraysEqual(manifestToolMediaIds, toolMediaIds) ||
    !arraysEqual(manifestLegacyPaths, legacyPaths)
  ) {
    throw new GenerationInputManifestError(
      "素材提交内容与界面顺序不一致，请刷新页面后重新提交",
    );
  }
}

export function interleaveGenerationInputValues<TTool, TLegacy>(
  manifest: GenerationInputManifestV1,
  toolValues: TTool[],
  legacyValues: TLegacy[],
): Array<TTool | TLegacy> {
  const toolCount = manifest.items.filter(
    (item) => item.source === "tool_media",
  ).length;
  const legacyCount = manifest.items.length - toolCount;
  if (toolValues.length !== toolCount || legacyValues.length !== legacyCount) {
    throw new GenerationInputManifestError("素材数量与顺序清单不一致");
  }

  let toolIndex = 0;
  let legacyIndex = 0;
  const ordered = manifest.items.map((item) =>
    item.source === "tool_media"
      ? toolValues[toolIndex++]
      : legacyValues[legacyIndex++],
  );
  if (toolIndex !== toolValues.length || legacyIndex !== legacyValues.length) {
    throw new GenerationInputManifestError("素材数量与顺序清单不一致");
  }
  return ordered;
}
