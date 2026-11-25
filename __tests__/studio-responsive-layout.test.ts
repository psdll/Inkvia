import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const studioSource = readFileSync(resolve(process.cwd(), "app/studio/page.tsx"), "utf8");

describe("studio responsive layout", () => {
  it("shows the toolbox and history columns at the current 1016px viewport", () => {
    expect(studioSource).toContain("min-[980px]:[grid-template-columns:var(--studio-left-col)_minmax(420px,1fr)]");
    expect(studioSource).toContain('min-[980px]:flex relative');
  });

  it("keeps the toolbox fluid while giving history the remaining width", () => {
    expect(studioSource).toContain('toolboxCollapsed ? "0px" : "clamp(400px,40vw,480px)"');
    expect(studioSource).not.toContain('toolboxCollapsed ? "0px" : "minmax(440px,500px)"');
  });

  it("keeps one themed Studio panel and its mode bar visible while a cold tool loads", () => {
    expect(studioSource).toContain("<StudioToolTabs");
    expect(studioSource).toContain('data-studio-tool-body-state={activeToolReady ? "ready" : "loading"}');
    expect(studioSource).toContain("{!activeToolReady ? <StudioToolBodyLoading /> : null}");
    expect(studioSource).not.toContain("{!displayedTool ? <StudioToolLoading /> : null}");
    expect(studioSource).not.toContain("transition-[grid-template-columns]");
    expect(studioSource).not.toContain("min-[980px]:transition-all");
  });
});
