import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkDetailModal } from "@/components/works/work-detail-modal";

describe("task-specific asset detail", () => {
  it("shows the saved speech settings in the same parameter section as other tasks", () => {
    const html = renderToStaticMarkup(React.createElement(WorkDetailModal, { open: true, onClose: () => {},
      item: { id: 1, type: "audio_gen", status: "success", prompt: "测试", localPath: "/uploads/a.mp3", createdAt: new Date().toISOString(),
        params: { voiceId: "voice-a", speed: 1.2, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", durationSeconds: 10 } },
    }));
    for (const label of ["音色", "语速", "声调", "音量", "音高", "强度", "音色调节", "音效", "音频时长"]) {
      expect(html.includes(`>${label}</div>`)).toBe(true);
    }
  });
  it.each([true, false])("does not offer audio template reuse or image/video inspiration actions (inline=%s)", (inlineActions) => {
    const html = renderToStaticMarkup(React.createElement(WorkDetailModal, {
      open: true, onClose: () => {}, inlineActions, onApplyTemplate: () => {}, onUploadInspiration: () => {}, onDelete: () => {},
      item: { id: 1, type: "audio_gen", status: "success", prompt: "测试", localPath: "/uploads/a.mp3", createdAt: new Date().toISOString() },
    }));
    expect(html.includes("一键同款")).toBe(false);
    expect(html.includes("上传灵感")).toBe(false);
    if (inlineActions) expect(html).toContain("删除");
  });
  it.each([
    ["image_edit", "图片", "/uploads/result.png"],
    ["video_gen", "视频", "/uploads/result.mp4"],
    ["audio_gen", "音频", "/uploads/result.mp3"],
    ["audio_gen", "音频", null],
  ])("renders %s with the media title %s", (type, label, localPath) => {
    const html = renderToStaticMarkup(React.createElement(WorkDetailModal, {
      open: true, onClose: () => {}, item: { id: 1, type: type!, status: localPath ? "success" : "failed", prompt: "测试", localPath,
        createdAt: new Date().toISOString(), outputPaths: localPath ? [localPath] : [] },
    }));
    expect(html).not.toContain("项目图片");
    expect(html).toContain(`>${label}</div>`);
    if (type === "audio_gen" && localPath) {
      expect(html).toContain("<audio");
      expect(html).toContain("语音合成");
      expect(html).not.toContain(`src="${localPath}" alt=`);
    }
  });
});
