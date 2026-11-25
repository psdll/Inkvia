// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import AgentMarkdown from "@/components/creative-agent/AgentMarkdown";

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

it("开发模式（StrictMode）下流式文字持续刷新，不会停在第一个字", async () => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const show = (text: string) => root.render(React.createElement(React.StrictMode, null, React.createElement(AgentMarkdown, { text, streaming: true })));
  await act(async () => show("我"));
  expect(host.textContent).toContain("我");
  await act(async () => show("我按高端别墅的电影感氛围出 4 个方向"));
  await act(async () => vi.advanceTimersByTimeAsync(60));
  expect(host.textContent).toContain("我按高端别墅的电影感氛围出 4 个方向");
  await act(async () => show("我按高端别墅的电影感氛围出 4 个方向，采用 16:9 横版。"));
  await act(async () => vi.advanceTimersByTimeAsync(60));
  expect(host.textContent).toContain("采用 16:9 横版。");
  await act(async () => root.unmount());
});
