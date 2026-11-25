import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("video generate audio parameter position", () => {
  it("renders generate audio below duration and outside advanced parameters", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/video/video-tool.tsx"),
      "utf8",
    );
    const panelStart = source.indexOf("const renderSeedanceParameterPanel");
    const panelEnd = source.indexOf("const promptPlaceholder", panelStart);

    expect(panelStart).toBeGreaterThanOrEqual(0);
    expect(panelEnd).toBeGreaterThan(panelStart);

    const panel = source.slice(panelStart, panelEnd);
    const durationStart = panel.indexOf("useDurationSlider ? (");
    const audioIndex = panel.indexOf('label="生成音频"');
    const advancedTriggerIndex = panel.indexOf(
      '<ParameterLabel label="高级参数"',
    );
    const advancedContentIndex = panel.indexOf(
      "(advOpen ? (",
      advancedTriggerIndex,
    );

    expect(durationStart).toBeGreaterThanOrEqual(0);
    expect(audioIndex).toBeGreaterThan(durationStart);
    expect(audioIndex).toBeLessThan(advancedTriggerIndex);
    expect(panel.match(/label="生成音频"/g)).toHaveLength(1);
    expect(panel.slice(advancedContentIndex)).not.toContain("音频");
    expect(panel).toContain(
      '<ParameterLabel label="高级参数" hint="控制联网搜索和固定镜头" />',
    );
  });

  it("uses an enabled or disabled segmented control with the audio help text", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/video/video-tool.tsx"),
      "utf8",
    );
    const panelStart = source.indexOf("const renderSeedanceParameterPanel");
    const panelEnd = source.indexOf("const promptPlaceholder", panelStart);
    const panel = source.slice(panelStart, panelEnd);

    expect(panel).toContain('label="生成音频"');
    expect(panel).toContain('hint="为生成的视频添加音频内容"');
    expect(panel).toContain('ariaLabel={parameterLabel("生成音频")}');
    expect(panel).toContain('value={generateAudio ? "enabled" : "disabled"}');
    expect(panel).toContain(
      'onChange={(value) => setGenerateAudio(value === "enabled")}',
    );
    expect(panel).toContain('{ label: parameterLabel("开启"), value: "enabled" }');
    expect(panel).toContain('{ label: parameterLabel("关闭"), value: "disabled" }');
    expect(panel).toContain("disabled={!modelSpec.supportsGenerateAudio}");
    expect(panel).not.toContain('<ToggleRow\n              label="生成音频"');

    const labelStart = source.indexOf("function ParameterLabel");
    const labelEnd = source.indexOf("function ToggleRow", labelStart);
    const parameterLabel = source.slice(labelStart, labelEnd);

    expect(parameterLabel).toContain("aria-label={hint}");
    expect(parameterLabel).toContain('role="tooltip"');
    expect(parameterLabel).toContain("group-hover:block");
    expect(parameterLabel).toContain("group-focus-within:block");
    expect(parameterLabel).toContain("absolute bottom-[calc(100%+8px)] left-0");
    expect(parameterLabel).not.toContain("left-1/2");
  });
});
