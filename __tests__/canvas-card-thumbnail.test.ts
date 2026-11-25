import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canvas list card thumbnail", () => {
  it("refreshes the persisted thumbnail from the current projection after every mutation", () => {
    const store = readFileSync("lib/canvas/prisma-mutation-store.ts", "utf8");
    const page = readFileSync("app/canvas/page.tsx", "utf8");

    expect(store).toContain('"thumbnail" = (');
    expect(store).toContain("candidate.\"url\"");
    expect(store).toContain("node.\"positionY\"");
    expect(store).toContain("node.\"kind\" = 'image'");
    expect(store).toContain("node.\"kind\" = 'imageTask'");
    expect(store).toContain("node.\"kind\" = 'video'");
    expect(store).toContain("node.\"kind\" = 'compare'");
    expect(store).toContain("node.\"data\"#>>'{data,variants,thumbnail,url}'");
    expect(store).toContain("node.\"data\"#>'{data,task,batches}'");
    expect(store).toContain("node.\"data\"#>>'{data,posterUrl}'");
    expect(store).toContain("node.\"data\"#>>'{data,beforeUrl}'");
    expect(store).toContain("SELECT set_config('TimeZone', 'UTC', true)");
    expect(page).toContain("canvas.thumbnail ? <ResilientImage");
  });
});
