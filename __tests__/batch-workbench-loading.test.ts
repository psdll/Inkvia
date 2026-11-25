import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses the batch two-column skeleton at both route and mode initialization", async () => {
  expect(existsSync("app/batch-workbench/loading.tsx")).toBe(true);
  const { default: Loading } = await import("../app/batch-workbench/loading");
  const html = renderToStaticMarkup(React.createElement(Loading));
  expect(html).toContain('role="status"');
  expect(html.match(/data-batch-loading-panel=""/g)).toHaveLength(2);
  expect(html).toContain("lg:grid-cols-[340px_minmax(0,1fr)]");
  expect(html).toContain("2xl:grid-cols-[360px_minmax(0,1fr)]");
  expect(html).not.toContain("<button");
  const source = readFileSync("components/batch-workbench/batch-workbench-page.tsx", "utf8");
  expect(source).toContain("if (!modeResolved) return <BatchWorkbenchLoading />;");
});
