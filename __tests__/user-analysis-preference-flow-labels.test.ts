import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(resolve(process.cwd(), "app/api/admin/user/route.ts"), "utf8");
const panelSource = readFileSync(resolve(process.cwd(), "components/admin/UserAnalysisPanel.tsx"), "utf8");

describe("user analysis preference-flow labels", () => {
  it("normalizes stored model ids and task types into their configured display labels", () => {
    expect(routeSource).toContain('import { TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models"');
    expect(routeSource).toContain("const preferenceModelLabels = new Map");
    expect(routeSource).toContain("function preferenceTaskTypeLabel");
    expect(routeSource).toContain('if (normalized === "image_edit") return "图片编辑"');
    expect(routeSource).toContain('if (normalized === "video_gen" || normalized === "video_generate") return "视频生成"');
    expect(routeSource).toContain("preferenceModelLabels.get(rawModel) || rawModel");
    expect(routeSource).toContain("preferenceTaskTypeLabel(rawTaskType)");
  });

  it("reads the video ratio field without changing the preference-flow response shape", () => {
    expect(routeSource).toContain("meta?.aspectRatio || meta?.aspect_ratio || meta?.ratio");
    expect(routeSource).toContain("String(m.aspectRatio || m.aspect_ratio || m.ratio || \"\").trim()");
    expect(routeSource).toContain("preferenceAspectRatioLabel(rawAspectRatio)");
    expect(routeSource).toContain("preferenceFlowMap.set(key, { model, taskType, aspectRatio, resolution, value: 1 })");
  });

  it("keeps every real label instead of collapsing names into an Other node", () => {
    expect(panelSource).not.toContain("function compactPreferenceFlows");
    expect(panelSource).not.toContain('compacted[stage.key] = "其他"');
    expect(panelSource).not.toContain("每列仅保留 Top 5");
    expect(panelSource).toContain("const records = normalizePreferenceFlows(flows)");
    expect(panelSource).toContain("function preferenceFlowChartHeight");
    expect(panelSource).toContain('viewBox={`0 0 1104 ${layout.chartHeight}`}');
  });
});
