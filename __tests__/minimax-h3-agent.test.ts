import { describe, expect, it } from "vitest";

import { createVideoTaskSchema } from "@/lib/generation/task-input-schema";

describe("MiniMax-H3 agent rules", () => {
  it("uses official H3 defaults without requesting an unsupported tail frame", () => {
    expect(createVideoTaskSchema.parse({
      model: "minimax-h3",
      prompt: "animate",
      inputMode: "first_frame",
      mediaPaths: ["/uploads/first.png"],
    })).toMatchObject({
      resolution: "768p",
      ratio: "adaptive",
      returnLastFrame: false,
    });
  });

  it("enforces mode-aware H3 ratios and unsupported parameters", () => {
    expect(createVideoTaskSchema.safeParse({
      model: "minimax-h3",
      prompt: "animate",
      inputMode: "text_to_video",
      ratio: "adaptive",
    }).success).toBe(false);
    expect(createVideoTaskSchema.safeParse({
      model: "minimax-h3",
      prompt: "animate",
      inputMode: "first_frame",
      mediaPaths: ["/uploads/first.png"],
      ratio: "16:9",
    }).success).toBe(false);
    expect(createVideoTaskSchema.safeParse({
      model: "minimax-h3",
      prompt: "animate",
      returnLastFrame: true,
    }).success).toBe(false);
  });

  it("allows the H3 7000-character prompt limit without widening existing models", () => {
    expect(createVideoTaskSchema.safeParse({
      model: "minimax-h3",
      prompt: "a".repeat(7_000),
    }).success).toBe(true);
    expect(createVideoTaskSchema.safeParse({
      model: "minimax-h3",
      prompt: "a".repeat(7_001),
    }).success).toBe(false);
    expect(createVideoTaskSchema.safeParse({
      model: "doubao-seedance-2-0-260128",
      prompt: "a".repeat(4_001),
    }).success).toBe(false);
  });
});
