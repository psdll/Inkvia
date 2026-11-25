import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Agent memory export/import lifecycle", () => {
  it("exports the structured profile and a consistency copy of .Agent", () => {
    const source = fs.readFileSync("lib/admin/user-export-builder.ts", "utf8");
    expect(source).toContain("data/agent_memory_profile.json");
    expect(source).toContain("agent/.Agent");
    expect(source).toContain("readAgentMemoryFile");
  });

  it("restores validated structured data and rebuilds the file instead of extracting archive text", () => {
    const source = fs.readFileSync("lib/admin/user-import-runner.ts", "utf8");
    expect(source).toContain('"data/agent_memory_profile.json"');
    expect(source).toContain("rebuildAgentMemoryProfileAfterImport");
    expect(source).not.toContain('resolveFileTarget(name) ?? resolveAgentMemory');
  });
});
