import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const materialsSource = readFileSync("app/materials/page.tsx", "utf8").replace(/\r\n/g, "\n");
const resilientImageSource = readFileSync("components/ui/resilient-image.tsx", "utf8").replace(/\r\n/g, "\n");

describe("materials image loading placeholder", () => {
  it("keeps the native image fallback hidden until a card preview loads", () => {
    expect(materialsSource).toMatch(
      /<ResilientImage[\s\S]*?candidates=\{cardImageCandidates\(item\)\}[\s\S]*?hideUntilLoaded/,
    );
    expect(resilientImageSource).toContain("hideUntilLoaded?: boolean;");
    expect(resilientImageSource).toContain("loadedSrc !== src");
    expect(resilientImageSource).toContain("setLoadedSrc(src);");
    expect(resilientImageSource).not.toContain("setLoaded(!hideUntilLoaded)");
  });
});
