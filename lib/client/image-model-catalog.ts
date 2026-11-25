"use client";

import type { ImageEditModel } from "@/components/batch-workbench/types";

type Catalog = { models: ImageEditModel[] };
const MAX_AGE_MS = 30_000;
let cached: { value: Catalog; expiresAt: number } | undefined;
let pending: { promise: Promise<Catalog>; refresh: boolean } | undefined;

// Public model metadata only; drafts and account data are never stored here.
export function loadImageModelCatalog({ refresh = false }: { refresh?: boolean } = {}): Promise<Catalog> {
  if (pending && (!refresh || pending.refresh)) return pending.promise;
  if (!refresh && cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  cached = undefined;
  const request = {
    refresh,
    promise: fetch("/api/image-edit/models", { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok || !Array.isArray(value?.models)) throw new Error("加载模型失败，请重试");
        if (pending === request) cached = { value, expiresAt: Date.now() + MAX_AGE_MS };
        return value as Catalog;
      })
      .finally(() => { if (pending === request) pending = undefined; }),
  };
  pending = request;
  return request.promise;
}
