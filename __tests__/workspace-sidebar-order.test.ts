import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "components/layout/workspace-sidebar.tsx"),
  "utf8",
);

describe("workspace sidebar navigation order", () => {
  it("places assets last in the main navigation, after the material library", () => {
    const navItems = source.slice(
      source.indexOf("const NAV_ITEMS = ["),
      source.indexOf("] as const;"),
    );
    const mainHrefs = Array.from(
      navItems.matchAll(/href:\s*"([^"]+)"[\s\S]*?slot:\s*"main"/g),
      (match) => match[1],
    );

    expect(mainHrefs.at(-1)).toBe("/works");
    expect(mainHrefs.slice(-2)).toEqual(["/materials", "/works"]);
  });
});
