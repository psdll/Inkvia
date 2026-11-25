import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCanvasImageModelDisplayLabel, resolveCanvasModelId } from "@/components/canvas/use-canvas-models";

const modelsHook = readFileSync("components/canvas/use-canvas-models.ts", "utf8");
const nodeCard = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");

describe("canvas task panel model stability", () => {
  it("reuses successfully loaded models when the task panel remounts", () => {
    expect(modelsHook).toContain("let cachedModels: CanvasModels | null = null");
    expect(modelsHook).toContain(
      "React.useState<CanvasModels | null>(() => cachedModels)",
    );
    expect(modelsHook).toContain("cachedModels = models");
  });

  it("falls back to the first enabled model instead of displaying a disabled state", () => {
    expect(modelsHook).toContain(
      "export function getCanvasImageModelDisplayLabel",
    );
    expect(modelsHook).toContain("export function resolveCanvasModelId");
    expect(nodeCard).toContain(
      "selectedModel?.label || getCanvasImageModelDisplayLabel(settings.model)",
    );
    expect(resolveCanvasModelId([{ id: "first" }, { id: "second" }], "second")).toBe("second");
    expect(resolveCanvasModelId([{ id: "first" }, { id: "second" }], "disabled")).toBe("first");
    expect(resolveCanvasModelId([], "disabled")).toBe("");
    expect(getCanvasImageModelDisplayLabel("custom-image-model")).not.toBe("模型已停用");
    expect(nodeCard).not.toContain("当前模型已停用，请重新选择管理员启用的模型");
  });
});
