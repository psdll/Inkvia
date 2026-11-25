import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
describe("studio loading boundary", () => {
  it("provides a dedicated route fallback and reuses it for page suspense", async () => {
    expect(existsSync(resolve(root, "app/studio/loading.tsx"))).toBe(true);
    const { default: Loading } = await import("../app/studio/loading");
    const html = renderToStaticMarkup(React.createElement(Loading));
    expect(html).toContain('role="status"');
    expect(html).toContain('data-studio-loading=""');
    expect(html).toContain('data-studio-tool-body-loading=""');
    expect(html).toContain('data-studio-history-loading=""');
    expect(html).not.toContain("<button");
    expect(readFileSync(resolve(root, "app/studio/page.tsx"), "utf8")).toContain("fallback={<StudioLoading />}");
  });
});
