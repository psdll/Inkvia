import { describe, expect, it } from "vitest";
import {
  readCanvasViewportPreference,
  writeCanvasViewportPreference,
} from "@/lib/canvas/viewport-preference";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("canvas viewport preference", () => {
  it("restores the exact viewport for one user and canvas only", () => {
    const target = storage();
    const viewport = { x: -233.241, y: 482.747, zoom: 0.288236 };

    writeCanvasViewportPreference(target, "user-7", 56, viewport);

    expect(readCanvasViewportPreference(target, "user-7", 56)).toEqual(viewport);
    expect(readCanvasViewportPreference(target, "user-8", 56)).toBeNull();
    expect(readCanvasViewportPreference(target, "user-7", 57)).toBeNull();
  });

  it("ignores malformed or non-finite stored values", () => {
    const target = storage();
    target.setItem("canvas_viewport_v1_user-7_56", JSON.stringify({ x: 1, y: 2, zoom: 0 }));
    expect(readCanvasViewportPreference(target, "user-7", 56)).toBeNull();
  });
});
