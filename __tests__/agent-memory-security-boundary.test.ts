import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("Agent memory private-file boundary", () => {
  it("blocks the private memory directory from the public uploads route", () => {
    const uploadRoute = read("app/api/uploads/[...path]/route.ts");
    const privatePath = read("lib/private-upload-path.ts");
    expect(uploadRoute).toContain("isPrivateUploadPath");
    expect(privatePath).toContain('normalized.startsWith(".agent-memory/")');
  });

  it("never exposes the private memory directory in Agent client or public API source", () => {
    const roots = ["app/agent", "components/creative-agent", "app/api/agent", "app/api/creative-agent"];
    const violations: string[] = [];
    const visit = (target: string) => {
      const absolute = path.join(process.cwd(), target);
      if (!fs.existsSync(absolute)) return;
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const child = path.join(absolute, entry.name);
        if (entry.isDirectory()) visit(path.relative(process.cwd(), child));
        else if (/\.[cm]?[jt]sx?$/.test(entry.name) && fs.readFileSync(child, "utf8").includes(".agent-memory")) {
          violations.push(path.relative(process.cwd(), child).replaceAll("\\", "/"));
        }
      }
    };
    roots.forEach(visit);
    expect(violations).toEqual([]);
  });
});
