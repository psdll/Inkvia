/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAdminPageSelection } from "@/components/admin/useAdminPageSelection";

let host: HTMLDivElement;
let root: Root;
function Panel({ name }: { name: string }) {
  const [selected, select] = useAdminPageSelection<string>(name, "first");
  return React.createElement("button", { onClick: () => select("second") }, selected);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("restores the selected platform after a full component remount", async () => {
  await act(async () => root.render(React.createElement(Panel, { name: "platform" })));
  await act(async () => host.querySelector("button")!.click());
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(React.createElement(Panel, { name: "platform" })));
  expect(host.textContent).toBe("second");
});
it("keeps unrelated page selections independent", async () => {
  sessionStorage.setItem("admin-page:other", "second");
  await act(async () => root.render(React.createElement(Panel, { name: "platform" })));
  expect(host.textContent).toBe("first");
  expect(sessionStorage.getItem("admin-page:other")).toBe("second");
});
it("still allows navigation when browser storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  await act(async () => root.render(React.createElement(Panel, { name: "platform" })));
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toBe("second");
});
