// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserExportModal from "@/components/admin/UserExportModal";
import ImportProgressModal from "@/components/admin/ImportProgressModal";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ maxExportBytes: 1024 }))));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("administrator migration dialogs", () => {
  it("exports a registered account as a portable archive with one click and no passphrase", async () => {
    const onExport = vi.fn();
    await act(async () => root.render(React.createElement(UserExportModal, {
      username: "alice", userId: "alice", registered: true, onClose: vi.fn(), onExport, progressState: null,
    })));
    const start = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("开始导出"))!;
    expect(container.textContent).toContain("包含账号和数据，导入后可直接使用");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    await act(async () => start.click());
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({
      archiveMode: "portable", includeLogs: true,
    }));
    expect(onExport.mock.calls[0][0]).not.toHaveProperty("migrationPassphrase");
  });

  it("exports an unregistered record as a data archive", async () => {
    const onExport = vi.fn();
    await act(async () => root.render(React.createElement(UserExportModal, {
      username: null, userId: "visitor", registered: false, onClose: vi.fn(), onExport, progressState: null,
    })));
    const start = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("开始导出"))!;
    await act(async () => start.click());
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ archiveMode: "data", includeLogs: false }));
  });

  it("requires explicit confirmation of the exact merge target before retrying", async () => {
    const onRetry = vi.fn();
    await act(async () => root.render(React.createElement(ImportProgressModal, {
      state: { stage: "error", message: "同名账号", progress: 0, jobId: "job-1", needsInput: { kind: "merge", username: "alice", targetUserId: 42 } },
      onClose: vi.fn(), onRetry,
    })));
    expect(container.textContent).toContain("alice（ID: 42）");
    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("使用已上传文件重试"))!;
    await act(async () => retry.click());
    expect(onRetry).not.toHaveBeenCalled();
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => Simulate.change(checkbox, { target: { checked: true } } as any));
    await act(async () => retry.click());
    expect(onRetry).toHaveBeenCalledWith("job-1", { mergeTargetUserId: 42 });
  });
});
