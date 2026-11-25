import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("admin library entry tabs", () => {
  it("opens material library management in a new tab", () => {
    const source = read("components/admin/AdminSystemTab.tsx");

    expect(source).toMatch(
      /href="\/admin\/material-assets\?from=materialAssets"\s+target="_blank"\s+rel="noopener noreferrer"/,
    );
  });

  it("opens the shared product library in a new tab", () => {
    const source = read("components/admin/AdminOssSection.tsx");

    expect(source).toMatch(
      /href="\/admin\/materials\?from=product"\s+target="_blank"\s+rel="noopener noreferrer"/,
    );
    expect(source).toContain("进入产品库");
    expect(source).not.toContain("进入共享素材库");
  });
});
