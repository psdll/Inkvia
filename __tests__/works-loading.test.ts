import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import Loading from "@/app/works/loading";
import { WorksGridSkeleton } from "@/components/works/works-loading";

it("uses the asset toolbar and square grid for route and authentication loading", () => {
  const html = renderToStaticMarkup(React.createElement(Loading));
  expect(html).toContain('data-works-loading=""');
  expect(html).toContain('role="status"');
  expect(html).toContain('gap-2.5');
  expect(html).toContain('min(100%,144px)');
  expect(html).not.toContain('<button');
  const source = readFileSync('app/works/page.tsx', 'utf8');
  expect(source).toContain('<WorksLoading tileSize={tileSize} />');
  expect(source).toContain('<WorksGridSkeleton tileSize={tileSize} />');
});
it("keeps the selected thumbnail size during data loading", () => {
  const html = renderToStaticMarkup(React.createElement(WorksGridSkeleton, { tileSize: 224 }));
  expect(html).toContain('min(100%,224px)');
});
