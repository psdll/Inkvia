"use client";

import type { QueryClient } from "@tanstack/react-query";
import { warmSettingsEntry } from "./settings-queries";
import { warmMaterialsEntry } from "./materials-entry";
import { warmWorksEntry } from "./works-entry";
import { warmCanvasEntry } from "./canvas-entry";
import { loadImageModelCatalog } from "./image-model-catalog";
import { fetchImageDraftForEntry } from "@/lib/tool-workspace-draft/entry-request";

export const FAST_WORKSPACE_ROUTES = ["/", "/studio", "/batch-workbench", "/materials", "/works", "/canvas", "/settings"] as const;
const codeRequests = new Map<string, Promise<unknown>>();

export function warmWorkspaceRoute(href: string, userId?: string, queryClient?: QueryClient): Promise<unknown> {
  const path = href.split("?")[0];
  if (!FAST_WORKSPACE_ROUTES.some(route => route === path)) return Promise.resolve();
  if (path === "/settings" && queryClient) void warmSettingsEntry(queryClient, userId);
  let tool = new URLSearchParams(href.split("?")[1]).get("tool");
  if (path === "/studio" && !tool && typeof window !== "undefined") {
    try { tool = localStorage.getItem("studio_last_tool_v1"); } catch {}
  }
  const codeKey = path === "/studio" ? `${path}:${tool === "video" ? tool : "image"}` : path;
  if (path === "/studio" && userId && tool !== "video") {
    void fetchImageDraftForEntry(userId).catch(() => undefined);
  }
  if (path === "/materials" && userId) warmMaterialsEntry(userId);
  if (path === "/works" && userId) warmWorksEntry(userId);
  if (path === "/canvas" && userId) warmCanvasEntry(Number(userId));
  if (path === "/studio" || path === "/batch-workbench") void loadImageModelCatalog().catch(() => undefined);
  const existing = codeRequests.get(codeKey);
  if (existing) return existing;
  // Importing modules prepares code; it must not mount tools or create drafts.
  const request = (path === "/"
    ? import("@/components/home/home-page-client")
    : path === "/studio"
      ? Promise.all([
          import("@/app/studio/page"),
          tool === "video" ? import("@/app/video/video-tool")
              : import("@/app/image/image-tool"),
          import("@/components/ui/prompt-rich-editor"),
        ])
      : path === "/settings" ? import("@/app/settings/page")
      : path === "/materials" ? import("@/app/materials/page")
      : path === "/works" ? import("@/app/works/page")
      : path === "/canvas" ? import("@/app/canvas/page")
      : import("@/components/batch-workbench/batch-workbench-page"))
    .catch(() => { codeRequests.delete(codeKey); });
  codeRequests.set(codeKey, request);
  return request;
}
