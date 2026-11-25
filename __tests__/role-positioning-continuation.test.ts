import { describe, expect, it } from "vitest";

import { parseRolePositioningContinuation } from "@/lib/role-positioning-continuation";

describe("role positioning continuation", () => {
  it("keeps the original non-empty toolbox prompt while a Skill task resumes", () => {
    expect(parseRolePositioningContinuation({
      kind: "toolbox_image_generation",
      taskId: 42,
      requestKey: "11111111-1111-4111-8111-111111111111",
      phase: "waiting",
      userPrompt: "用户原始提示词",
    }, "toolbox_image")).toMatchObject({
      userPrompt: "用户原始提示词",
    });
  });

  it("keeps video continuation isolated to the video surface", () => {
    const value = {
      kind: "toolbox_video_generation",
      taskId: 73,
      requestKey: "33333333-3333-4333-8333-333333333333",
      phase: "waiting",
      userPrompt: "原始视频提示词",
    };
    expect(parseRolePositioningContinuation(value, "toolbox_video"))
      .toMatchObject(value);
    expect(() => parseRolePositioningContinuation(value, "toolbox_image"))
      .toThrow("续跑入口不匹配");
  });
});
