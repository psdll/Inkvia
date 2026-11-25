import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Seedance resolution visibility in canvas", () => {
  it("returns the effective video model capabilities from the canvas model API", () => {
    const routeSource = source("app/api/canvas/models/route.ts");

    expect(routeSource).toContain("getVisibleToolboxModels(\"video\")");
    expect(routeSource).toContain("visibleVideoModels");
  });

  it("uses the API capability payload while restoring valid per-model parameters", () => {
    const hookSource = source("components/canvas/use-canvas-models.ts");
    const panelSource = source("components/canvas/CanvasNodeCard.tsx");
    const boardSource = source("components/canvas/SmartCanvasBoard.tsx");

    expect(hookSource).toContain("export type CanvasVideoModel");
    expect(hookSource).toContain("supportedResolutions");
    expect(hookSource).toContain("React.useState<CanvasModels | null>(() => cachedModels)");
    expect(hookSource).toContain("let cachedModels: CanvasModels | null = null");
    expect(hookSource).toContain("let inflight: Promise<CanvasModels> | null = null");
    expect(hookSource).toContain('capabilityStatus: "failed"');
    expect(hookSource).toContain("setModels(FALLBACK_CANVAS_MODELS)");
    expect(panelSource).toContain("getVideoDisplaySpec(model, models?.video || [])");
    expect(panelSource).toContain("editor?.changeTaskModel(id, nextModel);");
    expect(panelSource).toContain("videoParametersValid");
    expect(boardSource).toContain("restoreCanvasVideoModelPreference");
    expect(boardSource).toContain("normalizeCanvasVideoTaskForModel");
    expect(panelSource).not.toContain("if (!models || data.resolution === effectiveResolution) return");
    expect(panelSource).toContain("disabled={running || !selectedVideoModel || !videoParametersValid || Boolean(referenceError)}");
  });
});
