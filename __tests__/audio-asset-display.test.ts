import { describe, expect, it } from "vitest";
import { getGenerationDisplayFields } from "@/lib/generation-display-assets";
import { buildAdminAssetFeedData } from "@/lib/admin-asset-feed";
import { buildWorksListFilter } from "@/lib/admin-user-works";
import { buildWorkFeedProjection } from "../scripts/backfill-admin-work-feed.mjs";
import { buildAdminWorkFeedProjectionCtes } from "../lib/admin-work-feed-projection-sql.mjs";

describe("audio asset classification", () => {
  it.each(["mp3", "wav", "m4a", "aac", "ogg", "flac"])("keeps %s playable without image thumbnails", (ext) => {
    const localPath = `/uploads/canvas_audio_results/result.${ext}`;
    expect(getGenerationDisplayFields({ type: "audio_gen", localPath })).toEqual({
      displayKind: "audio", displayUrl: localPath, previewUrl: null, posterUrl: null, thumbUrl: null,
    });
  });

  it("classifies failed audio without a result URL", () => {
    expect(getGenerationDisplayFields({ type: "audio_gen" }).displayKind).toBe("audio");
  });

  it.each(["creation", "tool", "canvas", "batch", "agent"])("filters audio within %s without changing source rules", (source) => {
    expect(buildWorksListFilter("generated", "audio", source)).toEqual({
      ...buildWorksListFilter("generated", "all", source), type: "audio_gen",
    });
  });

  it("uses audio fields in both administrator feed projections", () => {
    const row = { id: 70, userId: "7", authUserId: 7, type: "audio_gen", source: "canvas", status: "success",
      prompt: "hello", model: "speech-2.8-hd", localPath: "/uploads/canvas_audio_results/old.mp3",
      templateData: null, externalProvider: "minimax", externalTaskId: null, errorMsg: null,
      createdAt: new Date(), updatedAt: new Date(), finishedAt: new Date() };
    for (const project of [buildAdminAssetFeedData, buildWorkFeedProjection]) {
      expect(project(row)).toMatchObject({ mediaKind: "audio", displayUrl: row.localPath, thumbUrl: null, previewUrl: null, posterUrl: null });
    }
  });

  it("classifies audio in the event worker SQL projection", () => {
    const sql = buildAdminWorkFeedProjectionCtes('SELECT * FROM "Generation"');
    expect(sql).toContain("'audio_gen'");
    expect(sql).toContain("THEN 'audio'");
    expect(sql).toContain("mp3|wav|m4a|aac|ogg|flac");
  });
});
