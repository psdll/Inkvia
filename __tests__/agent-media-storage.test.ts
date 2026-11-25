import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { generationOutputFolder } from "@/lib/generation/output-folder";
import * as uploadBuckets from "@/lib/upload-buckets";

describe("Agent media storage", () => {
  const uploadRouteSource = readFileSync(
    resolve(process.cwd(), "app/api/media-library/upload/route.ts"),
    "utf8",
  );
  const deleteRouteSource = readFileSync(
    resolve(process.cwd(), "app/api/media-library/[id]/route.ts"),
    "utf8",
  );
  const storageScanSource = readFileSync(
    resolve(process.cwd(), "lib/admin-storage-scan.ts"),
    "utf8",
  );
  const adminOverviewSource = readFileSync(
    resolve(process.cwd(), "components/admin/AdminOverviewTab.tsx"),
    "utf8",
  );

  it("routes Agent uploads to the dedicated import folder", () => {
    const resolveFolder = (
      uploadBuckets as typeof uploadBuckets & {
        mediaLibraryPrivateFolderForSource?: (
          source: string,
          usernameFolder: string,
          kind: string,
        ) => string;
      }
    ).mediaLibraryPrivateFolderForSource;

    expect(typeof resolveFolder).toBe("function");
    if (!resolveFolder) return;

    expect(resolveFolder("agent", "alice", "image")).toBe("Agent_imports");
    expect(resolveFolder("library", "alice", "image")).toBe(
      "products/private/user_alice/image",
    );
    expect(resolveFolder("unknown", "alice", "video")).toBe(
      "products/private/user_alice/video",
    );
  });

  it("routes every Agent generation media type to its dedicated result folder", () => {
    expect(generationOutputFolder("image_edit", "agent")).toBe("Agent_image_results");
    expect(generationOutputFolder("image_gen", "agent")).toBe("Agent_image_results");
    expect(generationOutputFolder("video_gen", "agent")).toBe("Agent_video_results");
    expect(generationOutputFolder("video_generate", "agent")).toBe("Agent_video_results");
    expect(generationOutputFolder("audio_gen", "agent")).toBe("Agent_audio_results");
    expect(generationOutputFolder("audio_generate", "agent")).toBe("Agent_audio_results");
    expect(generationOutputFolder("audio", "agent")).toBe("Agent_audio_results");

    expect(generationOutputFolder("image_edit", "tool")).toBe("image_results");
    expect(generationOutputFolder("video_gen", "canvas")).toBe(
      "canvas_video_results",
    );
  });

  it("marks Agent uploads and resolves the marker on the server", () => {
    expect(uploadRouteSource).toContain('form.get("uploadSource")');
    expect(uploadRouteSource).toContain("mediaLibraryPrivateFolderForSource");
  });

  it("recognizes only Agent import media refs for destructive removal", () => {
    const isAgentImportMediaRef = (
      uploadBuckets as typeof uploadBuckets & {
        isAgentImportMediaRef?: (value: unknown) => boolean;
      }
    ).isAgentImportMediaRef;

    expect(typeof isAgentImportMediaRef).toBe("function");
    if (!isAgentImportMediaRef) return;

    expect(isAgentImportMediaRef("/uploads/Agent_imports/2026-08-31/a.png")).toBe(true);
    expect(isAgentImportMediaRef("https://example.com/uploads/Agent_imports/2026-08-31/a.png?x=1")).toBe(true);
    expect(isAgentImportMediaRef("/uploads/products/private/user_alice/image/a.png")).toBe(false);
    expect(isAgentImportMediaRef("/uploads/Agent_image_results/2026-08-31/a.png")).toBe(false);
  });

  it("deletes Agent direct uploads from the attachment remove action without deleting selected library media", () => {
    expect(deleteRouteSource).toContain('searchParams.get("agentImportOnly") === "1"');
    expect(deleteRouteSource).toContain("isAgentImportMediaRef(item.fileUrl)");
    expect(deleteRouteSource).toContain("prisma.mediaLibraryItem.delete");
  });

  it("shows the Agent import and three result directories in the administrator storage overview", () => {
    expect(storageScanSource).toContain('folder: "Agent_imports"');
    expect(storageScanSource).toContain('folder: "Agent_image_results"');
    expect(storageScanSource).toContain('folder: "Agent_video_results"');
    expect(storageScanSource).toContain('folder: "Agent_audio_results"');
    expect(storageScanSource).not.toContain('folder: "Agent_results"');
    expect(storageScanSource).toContain(
      '"uploads/Agent_imports": { label: "Agent 导入素材"',
    );
    expect(storageScanSource).toContain(
      '"uploads/Agent_image_results": { label: "Agent 图片结果"',
    );
    expect(storageScanSource).toContain(
      '"uploads/Agent_video_results": { label: "Agent 视频结果"',
    );
    expect(storageScanSource).toContain(
      '"uploads/Agent_audio_results": { label: "Agent 音频结果"',
    );
    expect(adminOverviewSource).toContain('Agent_imports: "Agent 导入素材"');
    expect(adminOverviewSource).toContain('Agent_image_results: "Agent 图片结果"');
    expect(adminOverviewSource).toContain('Agent_video_results: "Agent 视频结果"');
    expect(adminOverviewSource).toContain('Agent_audio_results: "Agent 音频结果"');
    expect(adminOverviewSource).not.toContain('Agent_results: "Agent 生成结果"');
  });
});
