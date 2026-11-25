import { describe, expect, it } from "vitest";
import { createVideoTaskSchema } from "@/lib/generation/task-input-schema";

function mediaPaths(count: number) {
  return Array.from({ length: count }, (_, index) => `/uploads/reference-${index + 1}.png`);
}

describe("Seedance 2.5 agent contract", () => {
  it("accepts the 2.5 limits and official-only parameters", () => {
    const parsed = createVideoTaskSchema.safeParse({
      prompt: "edit the reference video",
      model: "doubao-seedance-2-5-260628",
      inputMode: "multimodal",
      mediaPaths: ["/uploads/reference-video.mp4", ...mediaPaths(49)],
      ratio: "adaptive",
      resolution: "1080p",
      duration: -1,
      omniReferenceTaskType: "edit",
      outputFormat: "mov",
    });

    expect(parsed.success).toBe(true);
  });

  it("allows 15 inputs for exact 2.0 while retaining the Fast limit", () => {
    expect(createVideoTaskSchema.safeParse({
      prompt: "use references",
      model: "doubao-seedance-2-0-260128",
      inputMode: "multimodal",
      mediaPaths: mediaPaths(15),
    }).success).toBe(true);

    expect(createVideoTaskSchema.safeParse({
      prompt: "use references",
      model: "doubao-seedance-2-0-fast-260128",
      inputMode: "multimodal",
      mediaPaths: mediaPaths(13),
    }).success).toBe(false);
  });

  it("rejects 2.5 requests above 50 and keeps adaptive ratio unavailable to other models", () => {
    expect(createVideoTaskSchema.safeParse({
      prompt: "too many references",
      model: "doubao-seedance-2-5-260628",
      inputMode: "multimodal",
      mediaPaths: mediaPaths(51),
    }).success).toBe(false);

    expect(createVideoTaskSchema.safeParse({
      prompt: "do not broaden Fast",
      model: "doubao-seedance-2-0-fast-260128",
      inputMode: "text_to_video",
      ratio: "adaptive",
    }).success).toBe(false);
  });
});
