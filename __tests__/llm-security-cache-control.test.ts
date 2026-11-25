import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("LLM security response cache policy", () => {
  it("marks new Agent responses and retired workspace responses as no-store", () => {
    const newApi = readFileSync(
      path.resolve(process.cwd(), "lib/creative-agent/api.ts"),
      "utf8",
    );
    const retired = readFileSync(
      path.resolve(process.cwd(), "lib/retired-agent-endpoint.ts"),
      "utf8",
    );
    expect(newApi).toContain('"Cache-Control": "no-store"');
    expect(retired).toContain(
      '"Cache-Control": "no-store, no-cache, no-transform"',
    );
  });
});
