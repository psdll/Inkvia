// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { describe, expect, it } from "vitest";
import { isDeliberateDoubleClick } from "@/lib/canvas/double-click-gate";

function press(time: number, x = 100, y = 100) {
  const event = new MouseEvent("pointerdown", { button: 0, clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "timeStamp", { value: time });
  window.dispatchEvent(event);
}

describe("canvas double-click gate", () => {
  it("accepts two quick presses in place and rejects slow or distant pairs", () => {
    press(1000); press(1250);
    expect(isDeliberateDoubleClick({ timeStamp: 1260 })).toBe(true);
    // Two separate clicks with a pause: the OS may still report dblclick.
    press(5000); press(5900);
    expect(isDeliberateDoubleClick({ timeStamp: 5910 })).toBe(false);
    press(8000); press(8200, 160, 100);
    expect(isDeliberateDoubleClick({ timeStamp: 8210 })).toBe(false);
  });

  it("lets a synthesized double-click through", () => {
    press(10_000);
    expect(isDeliberateDoubleClick({ timeStamp: 20_000 })).toBe(true);
  });
});
