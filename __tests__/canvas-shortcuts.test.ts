import { describe, expect, it } from "vitest";
import { resolveCanvasShortcut } from "@/lib/canvas/shortcuts";

const key = (key: string, modifiers = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers });

describe("canvas shortcut commands", () => {
  it.each([
    ["g", { ctrlKey: true }, "group"], ["g", { altKey: true }, "group"],
    ["G", { altKey: true, shiftKey: true }, "ungroup"],
    ["l", { ctrlKey: true }, "connect"], ["d", { ctrlKey: true }, "duplicate"],
    ["Enter", { ctrlKey: true }, "generate"], ["Tab", {}, "create"],
    ["=", { ctrlKey: true }, "zoomIn"], ["+", { ctrlKey: true, shiftKey: true }, "zoomIn"],
    ["-", { ctrlKey: true }, "zoomOut"], ["0", { ctrlKey: true }, "fit"],
    ["F", { altKey: true, shiftKey: true }, "arrange"],
    ["v", {}, "move"], ["H", {}, "hand"],
    ["z", { ctrlKey: true }, "undo"],
    ["z", { ctrlKey: true, shiftKey: true }, "redo"],
    ["z", { metaKey: true, shiftKey: true }, "redo"],
    ["Delete", {}, "delete"], ["Backspace", {}, "delete"],
  ])("maps %s with %j to %s", (name, modifiers, expected) => {
    expect(resolveCanvasShortcut(key(name as string, modifiers))).toBe(expected);
  });

  it("accepts Command on macOS and ignores unrelated modifier combinations", () => {
    expect(resolveCanvasShortcut(key("z", { metaKey: true }))).toBe("undo");
    for (const event of [key("h", { shiftKey: true }), key("g", { ctrlKey: true, altKey: true }), key("h", { ctrlKey: true }), key("Tab", { shiftKey: true }), key("v", { altKey: true }), key("z", { ctrlKey: true, altKey: true })]) {
      expect(resolveCanvasShortcut(event)).toBeNull();
    }
  });
});
