import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/creative-agent/media-inspection", () => ({ locateCreativeMedia: vi.fn() }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: {} }));
vi.mock("@/lib/creative-agent/model-catalog", () => ({ creativeAgentSupportsVision: vi.fn(), resolveCreativeAgentModel: vi.fn() }));

const { describeBreakdown, pickFrameSeconds, shotOf, splitShots } = await import("@/lib/creative-agent/video-analysis");

describe("爆款视频拆解", () => {
  it("按切点分镜，过近的切点合并", () => {
    expect(splitShots([1.8, 2.0, 3.2, 9.9], 10)).toEqual([{ start: 0, end: 1.8 }, { start: 1.8, end: 3.2 }, { start: 3.2, end: 10 }]);
    expect(splitShots([], 6)).toEqual([{ start: 0, end: 6 }]);
  });
  it("关键帧包含前 3 秒钩子帧和每个镜头中点，并限制数量", () => {
    const shots = splitShots([4, 8], 12);
    expect(pickFrameSeconds(shots, 12)).toEqual([0.2, 1.5, 2, 2.8, 6, 10]);
    const many = splitShots(Array.from({ length: 40 }, (_, index) => index + 1), 41);
    expect(pickFrameSeconds(many, 41, 16).length).toBeLessThanOrEqual(16);
  });
  it("帧所在镜头号从 1 开始，末尾时间算最后一镜", () => {
    const shots = splitShots([4], 8);
    expect(shotOf(shots, 1)).toBe(1);
    expect(shotOf(shots, 5)).toBe(2);
    expect(shotOf(shots, 8)).toBe(2);
  });
  it("拆解素材写清规格、镜头、台词和关键帧对应关系", () => {
    const text = describeBreakdown("ab12cd", {
      kind: "video", analyzedSeconds: 8,
      facts: { state: "verified", kind: "video", contentVersion: "x", durationSeconds: 8, width: 1080, height: 1920, frameRate: 30, audioCodecs: ["aac"] },
      shots: [{ start: 0, end: 4 }, { start: 4, end: 8 }],
      frames: [{ second: 0.2, shot: 1, data: "", mimeType: "image/jpeg" }, { second: 6, shot: 2, data: "", mimeType: "image/jpeg" }],
      transcript: [{ start: 0, end: 2.5, text: "你还在用老式按摩椅吗？" }],
    });
    expect(text).toContain("1080×1920（9:16）");
    expect(text).toContain("共 2 个，平均 4.0 秒/镜");
    expect(text).toContain("[00:00.0–00:02.5] 你还在用老式按摩椅吗？");
    expect(text).toContain("1) 00:00.2 第1镜；2) 00:06.0 第2镜");
  });
});
