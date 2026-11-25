import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const studioSource = readFileSync(resolve(root, "app/studio/page.tsx"), "utf8");
const panelSource = readFileSync(resolve(root, "components/media-library/media-library-panel.tsx"), "utf8");

describe("studio media library keepalive", () => {
  it("opts only the Studio shell into keeping the product library mounted", () => {
    expect(panelSource).toContain("keepMounted?: boolean;");
    expect(panelSource).toContain("keepMounted = false");
    expect(studioSource).toContain(
      "<MediaLibraryPanel open={open} onClose={close} keepMounted={hasOpened} />",
    );
  });

  it("preloads data while hidden instead of aborting and rehydrating on every open", () => {
    expect(panelSource).toContain("const dataActive = open || keepMounted;");
    expect(panelSource).toContain("if (!dataActive || !prefsHydrated) return;");
    expect(panelSource).toContain("if (dataActive) return;");
    expect(panelSource).not.toContain("if (!open) {\n      setPrefsHydrated(false);");
  });

  it("retains the mounted grid while closed but removes it from interaction", () => {
    expect(panelSource).toContain("{open || keepMounted ? (");
    expect(panelSource).toContain("aria-hidden={!open}");
    expect(panelSource).toContain('open ? "visible pointer-events-auto" : "invisible pointer-events-none"');
    expect(panelSource).toContain("{!open ? (");
  });
});
