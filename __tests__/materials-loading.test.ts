import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import Loading from "@/app/materials/loading";

it("uses the materials header and card grid at route entry and shares the grid during data loading", () => {
  const html = renderToStaticMarkup(React.createElement(Loading));
  expect(html).toContain('data-materials-loading=""');
  expect(html).toContain('role="status"');
  expect(html).toContain('data-materials-grid-loading=""');
  expect(html).toContain('gap-[3px]');
  expect(html).toContain('minmax(min(100%,240px),1fr)');
  expect(html).not.toContain("<button");
  const page = readFileSync("app/materials/page.tsx", "utf8");
  expect(page).toContain('import { MaterialSkeleton } from "@/components/materials/materials-loading"');
  expect(page.match(/<MaterialSkeleton \/>/g)).toHaveLength(2);
});
