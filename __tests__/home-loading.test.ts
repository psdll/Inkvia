import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("scopes the home skeleton to the root page and matches the inspiration grid", async () => {
  expect(existsSync("app/(home)/loading.tsx")).toBe(true);
  expect(existsSync("app/(home)/page.tsx")).toBe(true);
  expect(existsSync("app/page.tsx")).toBe(false);
  const { default: Loading } = await import("../app/(home)/loading");
  const html = renderToStaticMarkup(React.createElement(Loading));
  expect(html).toContain('role="status"');
  expect(html).toContain('data-home-hero-loading=""');
  expect(html).toContain('data-home-inspiration-loading=""');
  expect(html).toContain("xl:grid-cols-6");
  expect(html).toContain("aspect-[4/5]");
  expect(html).not.toContain("<button");
  expect(readFileSync("components/home/inspiration-discovery-section.tsx", "utf8")).toContain('from "@/components/home/home-loading"');
});
