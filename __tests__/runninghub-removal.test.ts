import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { generationOutputFolder } from "@/lib/generation/output-folder";

describe("RunningHub retirement boundaries", () => {
  it("removes the hidden tool and its submission path while retaining current creative models", () => {
    for (const file of ["app/face/page.tsx", "app/face/face-tool.tsx", "app/api/face-swap/route.ts", "lib/runninghub.ts", "data/workflows/runninghub-face-workflows.ts"]) {
      expect(existsSync(file), file).toBe(false);
    }
    expect(TOOLBOX_MODEL_DEFINITIONS.filter(m => m.category === "face")).toEqual([]);
    expect(TOOLBOX_MODEL_DEFINITIONS.map(m => m.id)).toEqual(expect.arrayContaining([
      "gpt-image-2", "gpt-image-2-apimart", "doubao-seedance-2.0-face", "doubao-seedance-2.0-fast-face",
    ]));
  });
  it("keeps historical face result storage and removes obsolete deployment requirements", () => {
    expect(generationOutputFolder("face_swap")).toBe("face_results");
    expect(readFileSync("scripts/deploy-preflight.mjs", "utf8")).not.toContain("RUNNINGHUB_WORKFLOW_");
  });
});
