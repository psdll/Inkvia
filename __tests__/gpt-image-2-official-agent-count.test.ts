import { describe, expect, it } from "vitest";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";

describe("GPT-Image-2 official Agent output count", () => {
  it("allows up to ten project tasks only for the two new provider models", () => {
    expect(createImageTaskSchema.safeParse({
      prompt: "test",
      model: "gpt-image-2-official-reapi",
      count: 10,
    }).success).toBe(true);
    expect(createImageTaskSchema.safeParse({
      prompt: "test",
      model: "gpt-image-2-aicoming-haiya",
      count: 10,
    }).success).toBe(true);
    expect(createImageTaskSchema.safeParse({
      prompt: "test",
      model: "gpt-image-2-apimart",
      count: 10,
    }).success).toBe(false);
  });
});
