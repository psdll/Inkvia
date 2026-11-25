import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/works/page.tsx", "utf8");

describe("works list thumbnail layout", () => {
  it("keeps list thumbnails compact instead of stretching with the row", () => {
    expect(source).toContain(
      'className="h-16 w-28 shrink-0 rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--input-bg)] flex items-center justify-center relative group/thumb"',
    );
    expect(source).not.toContain("w-[24%] min-w-20 max-w-[180px]");
  });
});
