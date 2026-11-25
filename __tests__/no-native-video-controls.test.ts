import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function tsxFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return tsxFiles(target);
    return entry.isFile() && target.endsWith(".tsx") ? [target] : [];
  });
}

describe("native video controls guard", () => {
  it("keeps browser-native video controls confined to the Agent result and reference previews", () => {
    const nativePreviews = [
      "components/creative-agent/AgentMedia.tsx",
      "components/creative-agent/AgentTurn.tsx",
      "components/creative-agent/CanvasAgentPanel.tsx",
    ];
    const roots = [path.join(process.cwd(), "app"), path.join(process.cwd(), "components")];
    const violations = roots.flatMap(tsxFiles).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/<video\b[\s\S]*?>/g)]
        .filter((match) => /\bcontrols(?:\s*=|\s|>)/.test(match[0]))
        .map(() => path.relative(process.cwd(), file));
    });

    expect(violations.sort()).toEqual(nativePreviews);
  });
});
