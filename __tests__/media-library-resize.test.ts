import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/media-library/media-library-panel.tsx"), "utf8");
const globalStyles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("media library resize handle", () => {
  it("keeps the panel grid column shrinkable in narrow workspaces", () => {
    expect(source).toContain("grid-cols-[minmax(0,1fr)]");
  });

  it("can expand to the bottom edge of every host workspace", () => {
    expect(source).toContain("const MEDIA_LIBRARY_MIN_BOTTOM_PEEK = 0;");
    expect(source).toContain("Math.round(hostHeight - MEDIA_LIBRARY_MIN_BOTTOM_PEEK)");
  });

  it("keeps the resize handle inside the panel boundary used by outside-click handling", () => {
    expect(source).toMatch(/<div\s+ref=\{panelRef\}[\s\S]*?aria-label="拖拽调整素材库高度"/);
    expect(source).not.toMatch(/<section\s+ref=\{panelRef\}/);
  });
  it("reuses the neutral glow border for the vertical resize control", () => {
    expect(source).toContain('className="media-library-resize-handle group');
    expect(globalStyles).toMatch(/\.media-library-card-button,\s*\.media-library-resize-handle \{/);
    expect(globalStyles).toMatch(
      /\.media-library-resize-handle:hover,[\s\S]*?\.media-library-resize-handle:focus-visible[\s\S]*?box-shadow:/,
    );
    expect(globalStyles).toMatch(/\.media-library-resize-handle:focus-visible \{\s*outline: none;/);
  });
});

describe("media library surface color", () => {
  it("uses the shared #202020 dark panel token without changing other solid panels", () => {
    expect(source).toContain('className="media-library-panel solid-panel-surface');
    expect(globalStyles).toMatch(
      /html\.dark \.media-library-panel,[\s\S]*?\[data-theme="dark"\] \.media-library-panel[\s\S]*?--solid-panel-bg: var\(--dropdown-panel-bg, #202020\);/,
    );
  });

  it("does not cast a dark shadow below the collapsed product-library trigger", () => {
    const ariaIndex = source.indexOf('aria-label="打开产品库"');
    const buttonIndex = source.lastIndexOf("<button", ariaIndex);
    const collapsedTrigger = source.slice(buttonIndex, ariaIndex);

    expect(ariaIndex).toBeGreaterThan(-1);
    expect(buttonIndex).toBeGreaterThan(-1);
    expect(collapsedTrigger).not.toContain("shadow-[0_10px_24px_rgba(15,23,42,0.12)]");
  });
});

describe("media library card affordance", () => {
  it("uses a neutral glow border that strengthens on hover and keyboard focus", () => {
    expect(source).toContain('className="media-library-card-button group');
    expect(globalStyles).toMatch(
      /\.media-library-card-button(?:,\s*\.media-library-resize-handle)? \{[\s\S]*?border: 1px solid color-mix\(in srgb, var\(--app-fg\)[\s\S]*?box-shadow:[\s\S]*?var\(--app-fg\)/,
    );
    expect(globalStyles).toMatch(
      /\.media-library-card-button:hover,[\s\S]*?\.media-library-card-button:focus-within[\s\S]*?box-shadow:/,
    );
  });
});
