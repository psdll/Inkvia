import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("provider success metadata persistence", () => {
  it("does not persist complete upstream response bodies in generation template data", () => {
    const imageService = read("lib/generation/image-service.ts");

    expect(imageService).not.toContain("response: generated.raw");
    expect(imageService).not.toContain("submit: submitted.raw");
    expect(imageService).not.toContain("queue: submitted.raw");
  });
});
