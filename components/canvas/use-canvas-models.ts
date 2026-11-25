"use client";

import * as React from "react";
import type { CanvasImageModelParams } from "@/lib/canvas/image-task";
import type { GptImage25VariantOptions } from "@/lib/gpt-image-25-models";
import type { Sora2ResolutionValue } from "@/lib/sora2";
import { subscribeToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";

// 画布节点共享的模型清单（/api/canvas/models）。模块级缓存，避免每个节点各拉一次。

export type CanvasImageModel = GptImage25VariantOptions & {
  id: string;
  label: string;
  provider: string;
  category: string;
  params: CanvasImageModelParams;
};
export type CanvasVideoModel = {
  id: string;
  label: string;
  provider: string;
  category: string;
  supportedResolutions: Sora2ResolutionValue[];
  maxDurationSeconds?: number;
  allowAutoDuration?: boolean;
};
export type CanvasAudioModel = {
  id: string;
  label: string;
  provider: string;
  category: "audio";
};
export type CanvasChatModel = {
  label?: string;
  thinkingLevels?: import("@/lib/llm-routing/reasoning").LlmThinkingLevel[];
  thinkingDefault?: import("@/lib/llm-routing/reasoning").LlmThinkingLevel;
  id: string;
  modelId: string;
  providerId: string;
  providerName: string;
  protocol: string;
  status: "ready";
};
export type CanvasRouteSnapshot = {
  providerId?: string;
  providerName?: string;
  modelId?: string;
  protocol?: string;
  source?: string;
  status: string;
};
export type CanvasModels = {
  image: CanvasImageModel[];
  video: CanvasVideoModel[];
  audio: CanvasAudioModel[];
  chat: CanvasChatModel[];
  canvasDefault: CanvasRouteSnapshot;
  capabilityStatus: "loaded" | "failed";
};

const FALLBACK_CANVAS_MODELS: CanvasModels = {
  image: [],
  video: [],
  audio: [],
  chat: [],
  canvasDefault: { status: "unavailable" },
  capabilityStatus: "failed",
};

let inflight: Promise<CanvasModels> | null = null;
let inflightRevision = -1;
let cachedModels: CanvasModels | null = null;
let cacheRevision = 0;
const modelListeners = new Set<(models: CanvasModels) => void>();
let visibilitySubscribed = false;

export function resolveCanvasModelId<T extends { id: string }>(models: T[], modelId?: string): string {
  const requestedModelId = String(modelId || "").trim();
  return requestedModelId && models.some((model) => model.id === requestedModelId)
    ? requestedModelId
    : models[0]?.id || "";
}

export function getCanvasImageModelDisplayLabel(modelId: string): string {
  const models = cachedModels?.image || [];
  const enabledModelId = resolveCanvasModelId(models, modelId);
  return models.find((model) => model.id === enabledModelId)?.label || "";
}

async function fetchModels(): Promise<CanvasModels> {
  const res = await fetch("/api/canvas/models", { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data?.success !== true) throw new Error("canvas models unavailable");
  return {
    image: Array.isArray(data?.image) ? data.image : [],
    video: Array.isArray(data?.video) ? data.video : [],
    audio: Array.isArray(data?.audio) ? data.audio : [],
    chat: Array.isArray(data?.chat) ? data.chat : [],
    canvasDefault: data?.canvasDefault && typeof data.canvasDefault === "object"
      ? data.canvasDefault
      : { status: "missing-binding" },
    capabilityStatus: "loaded",
  };
}

function requestModels(): Promise<CanvasModels> {
  if (cachedModels) return Promise.resolve(cachedModels);
  if (!inflight || inflightRevision !== cacheRevision) {
    const revision = cacheRevision;
    const request = fetchModels()
      .then((models) => {
        if (revision === cacheRevision) cachedModels = models;
        return models;
      })
      .finally(() => {
        if (inflight === request) inflight = null;
      });
    inflight = request;
    inflightRevision = revision;
  }
  return inflight;
}

function refreshModels() {
  cacheRevision += 1;
  cachedModels = null;
  const revision = cacheRevision;
  void requestModels()
    .then((models) => {
      if (revision !== cacheRevision) return;
      for (const listener of modelListeners) listener(models);
    })
    .catch(() => undefined);
}

function subscribeCanvasModels(listener: (models: CanvasModels) => void) {
  modelListeners.add(listener);
  if (!visibilitySubscribed) {
    subscribeToolboxModelVisibilityChanged(refreshModels);
    visibilitySubscribed = true;
  }
  return () => {
    modelListeners.delete(listener);
  };
}

export function useCanvasModels(): CanvasModels | null {
  const [models, setModels] = React.useState<CanvasModels | null>(() => cachedModels);
  React.useEffect(() => {
    let alive = true;
    const applyModels = (nextModels: CanvasModels) => {
      if (alive) setModels(nextModels);
    };
    const unsubscribe = subscribeCanvasModels(applyModels);
    const revision = cacheRevision;
    requestModels()
      .then((nextModels) => {
        if (revision === cacheRevision) applyModels(nextModels);
      })
      .catch(() => {
        if (alive && revision === cacheRevision) setModels(FALLBACK_CANVAS_MODELS);
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return models;
}
