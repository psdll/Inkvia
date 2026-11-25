import { createRequire } from "node:module";
import { expect, it } from "vitest";

const { windowCloseAction, needsExitConfirmation, normalizeCloseSetting } =
  createRequire(import.meta.url)("../desktop/lib/close-policy.cjs");

it.each([
  ["darwin", undefined, "background"],
  ["darwin", "background", "background"],
  ["darwin", "exit", "exit"],
  ["darwin", "ask", "background"],
  ["win32", undefined, "ask"],
  ["win32", "background", "background"],
  ["win32", "exit", "exit"],
  ["win32", "ask", "ask"],
])("chooses the close action on %s with %s", (platform, setting, expected) => {
  expect(windowCloseAction(platform, setting)).toBe(expected);
});

it("accepts only platform-supported preferences", () => {
  expect(normalizeCloseSetting("win32", {})).toBeNull();
  expect(normalizeCloseSetting("darwin", "ask")).toBeNull();
  expect(normalizeCloseSetting("win32", "ask")).toBe("ask");
});

it.each([
  ["user", 0, false], ["user", 3, true], ["user", null, true],
  ["shutdown", 3, false], ["relaunch", 3, false],
])("confirms only actual user quits with possible pending work (%s, %s)", (reason, count, expected) => {
  expect(needsExitConfirmation(reason, count)).toBe(expected);
});
