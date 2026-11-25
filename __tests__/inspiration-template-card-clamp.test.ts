import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/admin/InspirationTemplatesPanel.tsx"), "utf8");

describe("inspiration template card text clamping", () => {
  it("keeps compact title and prompt previews without extension-targeted line-clamp classes", () => {
    const cards = source.slice(
      source.indexOf('className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"'),
      source.indexOf("<ConfirmDialog"),
    );

    expect(cards).toContain("[-webkit-line-clamp:1]");
    expect(cards).toContain("[-webkit-line-clamp:2]");
    expect(cards).not.toContain("line-clamp-1");
    expect(cards).not.toContain("line-clamp-2");
  });
});
