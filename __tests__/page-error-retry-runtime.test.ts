/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PageError from "@/app/error";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("page error recovery", () => {
  it.each([
    ["ChunkLoadError", "Loading chunk _app-pages-browser_components_admin_UserRoleSkillsPanel_tsx failed.", true],
    ["Error", "Loading chunk 123 failed.", true],
    ["Error", "Unable to load user details", false],
  ])("retries %s: %s", async (name, message, needsReload) => {
    const error = new Error(message);
    error.name = name;
    const reset = vi.fn();
    const reload = vi.fn();
    await act(async () => root.render(React.createElement(PageError, { error, reset })));
    vi.stubGlobal("window", new Proxy(window, {
      get(target, key) {
        return key === "location" ? { reload } : Reflect.get(target, key);
      },
    }));
    await act(async () => host.querySelector("button")!.click());
    expect(reload).toHaveBeenCalledTimes(needsReload ? 1 : 0);
    expect(reset).toHaveBeenCalledTimes(needsReload ? 0 : 1);
  });
});
