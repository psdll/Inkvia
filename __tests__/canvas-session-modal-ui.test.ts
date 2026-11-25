import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasSessionExpiredModal } from "@/components/canvas/CanvasSessionExpiredModal";
import fs from "node:fs";
import path from "node:path";

describe("canvas session expired modal", () => {
  it("keeps the session modal geometry and copy", () => {
    const html = renderToStaticMarkup(React.createElement(CanvasSessionExpiredModal, { onRefresh: vi.fn() }));

    expect(html).toContain("会话已过期");
    expect(html).toContain("此画布已在其他标签页或浏览器中打开");
    expect(html).toContain("请刷新页面以继续编辑");
    expect(html).toContain("刷新页面");
    expect(html).toContain("z-index:9999");
    expect(html).toContain("backdrop-filter:blur(8px)");
    expect(html).toContain("width:320px");
    expect(html).toContain("height:241px");
    expect(html).toContain("border-radius:24px");
    expect(html).toContain("padding:40px 16px");
    expect(html).toContain("width:80px");
    expect(html).toContain("height:40px");
    expect(html).toContain("autofocus=\"\"");
  });

  it("wires the exclusive session through page loading, saves, and the blocking modal", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components/canvas/CanvasEditorPage.tsx"), "utf8");

    expect(source).toContain("claimCanvasEditorSession");
    expect(source).toContain("sessionId: identity.tabId");
    expect(source).toContain("}, [authUserId, canvasId, expireEditorSession, restoreStoredViewport]);");
    expect(source).toContain("CanvasSessionExpiredModal");
    expect(source).toContain("sessionExpiredRef.current");
    expect(source).toContain("sessionId: editorSessionIdRef.current");
    expect(source).toContain("reason.code === \"CANVAS_SESSION_EXPIRED\"");
    expect(source).toMatch(/sessionExpiredRef\.current = true;[\s\S]{0,200}pendingRef\.current = null/);
    expect(source).toMatch(/await drainSaveQueue\(\);\s*if \(sessionExpiredRef\.current/);
    expect(source).toContain("sessionExpired ? <CanvasSessionExpiredModal");
  });

  it("traps Tab navigation inside the blocking modal", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components/canvas/CanvasSessionExpiredModal.tsx"), "utf8");

    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("refreshButtonRef.current?.focus()");
  });

  it("guards every canvas task-creating POST with the active session", () => {
    const board = fs.readFileSync(path.join(process.cwd(), "components/canvas/SmartCanvasBoard.tsx"), "utf8");
    const runner = fs.readFileSync(path.join(process.cwd(), "components/canvas/run-node.ts"), "utf8");

    expect(board).toContain("editorSessionId: string");
    expect(board).toContain('"X-Canvas-Session-Id": editorSessionId');
    expect(board).toContain("await onBeforeServerRun()");
    expect(runner).toContain('"X-Canvas-Session-Id": opts.sessionId');
    expect(runner).toContain('"X-Canvas-Id": String(opts.canvasId)');
    for (const route of ["generate", "generate-video", "llm"]) {
      const source = fs.readFileSync(path.join(process.cwd(), `app/api/canvas/${route}/route.ts`), "utf8");
      expect(source).toContain("canvasEditorSessionMatches");
      expect(source).toContain('req.headers.get("X-Canvas-Session-Id")');
      expect(source).toContain('req.headers.get("X-Canvas-Id")');
    }
  });
});
