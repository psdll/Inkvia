import { describe, expect, it } from "vitest";
import {
  canSoftDeleteToolMedia,
  canPurgeToolRelay,
  isTerminalGenerationStatus,
  isToolInputMedia,
  isToolMediaLocalPath,
  TOOL_MEDIA_DRAFT_RETENTION_MS,
  TOOL_MEDIA_RELEASE_RETENTION_MS,
  TOOL_MEDIA_RELAY_GRACE_MS,
  toolMediaRetentionDeadline,
} from "@/lib/tool-media/lifecycle";

describe("tool input media lifecycle", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("sets the documented draft and release retention deadlines", () => {
    expect(TOOL_MEDIA_DRAFT_RETENTION_MS).toBe(24 * 60 * 60 * 1000);
    expect(TOOL_MEDIA_RELEASE_RETENTION_MS).toBe(10 * 60 * 1000);
    expect(toolMediaRetentionDeadline("draft", now)).toEqual(new Date("2026-07-25T12:00:00.000Z"));
    expect(toolMediaRetentionDeadline("release", now)).toEqual(new Date("2026-07-24T12:10:00.000Z"));
  });

  it("recognizes only tool_input media metadata", () => {
    expect(isToolInputMedia({ origin: "tool_input" })).toBe(true);
    expect(isToolInputMedia({ origin: "canvas" })).toBe(false);
    expect(isToolInputMedia(null)).toBe(false);
  });

  it("accepts new imports and historical tool_inputs paths only", () => {
    expect(isToolMediaLocalPath("/uploads/imports/2026-07-27/new.png")).toBe(
      true,
    );
    expect(
      isToolMediaLocalPath("/uploads/tool_inputs/2026-07-24/old.png"),
    ).toBe(true);
    expect(isToolMediaLocalPath("/uploads/image_results/output.png")).toBe(
      false,
    );
    expect(
      isToolMediaLocalPath("uploads/imports/missing-leading-slash.png"),
    ).toBe(false);
  });

  it("recognizes only successful and failed generation statuses as terminal", () => {
    expect(isTerminalGenerationStatus("success")).toBe(true);
    expect(isTerminalGenerationStatus("failed")).toBe(true);
    expect(isTerminalGenerationStatus("running")).toBe(false);
    expect(isTerminalGenerationStatus("cancelled")).toBe(false);
  });

  it("allows soft deletion only for unreferenced ready tool input media", () => {
    expect(
      canSoftDeleteToolMedia({
        metadata: { origin: "tool_input" },
        status: "ready",
        generationInputCount: 0,
      }),
    ).toBe(true);
    expect(
      canSoftDeleteToolMedia({
        metadata: { origin: "tool_input" },
        status: "ready",
        generationInputCount: 1,
      }),
    ).toBe(false);
    expect(
      canSoftDeleteToolMedia({
        metadata: { origin: "tool_input" },
        status: "processing",
        generationInputCount: 0,
      }),
    ).toBe(false);
    expect(
      canSoftDeleteToolMedia({
        metadata: { origin: "canvas" },
        status: "ready",
        generationInputCount: 0,
      }),
    ).toBe(false);
  });

  it("purges a tool relay only after every generation is terminal and its grace period has elapsed", () => {
    const latestFinishedAt = new Date("2026-07-24T11:30:00.000Z");

    expect(TOOL_MEDIA_RELAY_GRACE_MS).toBe(30 * 60 * 1000);
    expect(
      canPurgeToolRelay({
        metadata: { origin: "tool_input" },
        generationStatuses: ["success", "failed"],
        latestFinishedAt,
        now,
      }),
    ).toBe(true);
    expect(
      canPurgeToolRelay({
        metadata: { origin: "tool_input" },
        generationStatuses: ["success", "running"],
        latestFinishedAt,
        now: new Date("2026-07-25T12:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      canPurgeToolRelay({
        metadata: { origin: "tool_input" },
        generationStatuses: ["success"],
        latestFinishedAt: null,
        now,
      }),
    ).toBe(false);
    expect(
      canPurgeToolRelay({
        metadata: { origin: "tool_input" },
        generationStatuses: ["success"],
        latestFinishedAt,
        now: new Date(latestFinishedAt.getTime() + TOOL_MEDIA_RELAY_GRACE_MS - 1),
      }),
    ).toBe(false);
    expect(
      canPurgeToolRelay({
        metadata: { origin: "tool_input" },
        generationStatuses: ["success"],
        latestFinishedAt,
        now: new Date(latestFinishedAt.getTime() + TOOL_MEDIA_RELAY_GRACE_MS),
      }),
    ).toBe(true);
  });

  it("never selects non-tool input media for tool relay GC", () => {
    expect(
      canPurgeToolRelay({
        metadata: { origin: "canvas" },
        generationStatuses: ["success"],
        latestFinishedAt: new Date("2026-07-24T11:00:00.000Z"),
        now,
      }),
    ).toBe(false);
  });
});
