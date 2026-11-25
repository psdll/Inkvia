import { describe, expect, it, vi } from "vitest";
import {
  fetchCanvasMiniMaxVoices,
  fetchCanvasVoiceFavorites,
} from "@/components/canvas/use-canvas-minimax-voices";

describe("canvas MiniMax voice queries", () => {
  it("normalizes the private catalog response", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          voices: [
            {
              id: "female-shaonv",
              name: "少女音色",
              description: "",
              source: "system",
            },
          ],
          stale: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(fetchCanvasMiniMaxVoices(request)).resolves.toEqual({
      voices: [
        expect.objectContaining({
          id: "female-shaonv",
          gender: "female",
          age: "youth",
        }),
      ],
      stale: false,
    });
    expect(request).toHaveBeenCalledWith("/api/canvas/speech/voices", {
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("returns the current user's favorite ids", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, voiceIds: ["female-shaonv"] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(fetchCanvasVoiceFavorites(request)).resolves.toEqual([
      "female-shaonv",
    ]);
  });

  it("surfaces the server message without clearing cached data", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "音色服务暂不可用" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(fetchCanvasMiniMaxVoices(request)).rejects.toThrow(
      "音色服务暂不可用",
    );
  });
});
