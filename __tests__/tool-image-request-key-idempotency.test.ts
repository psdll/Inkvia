import fs from "node:fs";
import path from "node:path";
import { validate as validateUuid } from "uuid";
import { describe, expect, it } from "vitest";

import {
  classifyExistingImageGenerationReplay,
  deriveImageTaskRequestKey,
  normalizeImageSubmissionRequestKey,
} from "@/lib/generation/image-request-key";

describe("tool image request-key idempotency", () => {
  const submissionKey = "11111111-1111-4111-8111-111111111111";
  const readProjectFile = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

  it("derives stable and distinct UUID keys for each requested output", () => {
    const first = deriveImageTaskRequestKey(submissionKey, 1);
    const firstReplay = deriveImageTaskRequestKey(submissionKey, 1);
    const second = deriveImageTaskRequestKey(submissionKey, 2);

    expect(first).toBe(firstReplay);
    expect(second).not.toBe(first);
    expect(validateUuid(first!)).toBe(true);
    expect(validateUuid(second!)).toBe(true);
  });

  it("keeps legacy calls without a request key optional", () => {
    expect(normalizeImageSubmissionRequestKey(undefined)).toBeUndefined();
    expect(deriveImageTaskRequestKey(undefined, 1)).toBeUndefined();
  });

  it("rejects malformed request keys and invalid output indexes", () => {
    expect(() => normalizeImageSubmissionRequestKey("not-a-uuid")).toThrow("requestKey");
    expect(() => deriveImageTaskRequestKey(submissionKey, 0)).toThrow("batchIndex");
  });

  it("keeps a replayed failed generation terminal instead of reporting it as running", () => {
    expect(classifyExistingImageGenerationReplay({
      status: "failed",
      localPath: null,
      errorMsg: "provider rejected request",
    })).toEqual({
      status: "failed",
      error: "provider rejected request",
    });
  });

  it("sends one stable submission key and blocks concurrent browser submits", () => {
    const source = readProjectFile("app/image/image-tool.tsx");

    expect(source).toContain("const generationSubmitInFlightRef = React.useRef(false)");
    expect(source).toContain("if (generationSubmitInFlightRef.current || reverseLoading || hasRunningReverseTask) return");
    expect(source).toContain('form.set("requestKey", batchId)');
    expect(source).toContain("generationSubmitInFlightRef.current = false");
  });

  it("validates the submitted key and derives one child key per output", () => {
    const source = readProjectFile("lib/generation/image-service.ts");

    expect(source).toContain('normalizeImageSubmissionRequestKey(formData.get("requestKey"))');
    expect(source).toContain("deriveImageTaskRequestKey(input.requestKey, batchIndex)");
  });

  it("repairs legacy duplicate keys only in explicit apply mode before the online index", () => {
    const scriptPath = path.join(process.cwd(), "scripts/repair-generation-request-key-duplicates.mjs");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf8");
    const onlineIndex = readProjectFile("config/deploy/online-indexes/generation-request-key.sql");

    expect(script).toContain('process.argv.includes("--apply")');
    expect(script).toContain('ROW_NUMBER() OVER (PARTITION BY "requestKey" ORDER BY "id")');
    expect(script).toContain('SET "requestKey" = NULL');
    expect(script).toContain("remainingDuplicateGroups");
    expect(onlineIndex).toContain('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Generation_requestKey_key"');
    expect(onlineIndex).toContain('WHERE "requestKey" IS NOT NULL');
  });
});
