import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "components/history/unified-history-panel.tsx"),
  "utf8",
);

function sourceBetween(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("unified history group viewport", () => {
  it("fits grouped results inside the available viewport without freeform overflow", () => {
    const groupCanvas = sourceBetween(
      ") : hasGroupDisplay && activeGroupId ? (",
      "{activeGroupItems.map((it, groupIndex) => {",
    );

    expect(groupCanvas).toContain(
      'className="h-full w-full overflow-hidden"',
    );
    expect(groupCanvas).toContain(
      'className="grid h-full min-h-0 w-full gap-3"',
    );
    expect(groupCanvas).not.toContain("overflow-auto");
    expect(groupCanvas).not.toContain("min-h-[720px]");
  });
});
