import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.hoisted(() => ({
  canvas: { enabled: false, ready: false },
  agent: { enabled: false, ready: false, statusLoaded: false },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/studio",
  useRouter: () => ({ prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({ default: ({ children, prefetch, ...props }: any) => React.createElement("a", props, children) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, openLoginModal: vi.fn() }) }));
vi.mock("@/components/feedback/feedback-modal", () => ({ FeedbackModal: () => null }));
vi.mock("@/components/ui/BrandLogo", () => ({ default: () => null }));
import { WorkspaceSidebar } from "@/components/layout/workspace-sidebar";

const navigation = () => renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(WorkspaceSidebar))).match(/<nav\b[\s\S]*?<\/nav>/)![0];

beforeEach(() => {
  status.canvas = { enabled: false, ready: false };
  status.agent = { enabled: false, ready: false, statusLoaded: false };
});

describe("workspace navigation initial layout", () => {
  it("exposes core navigation while feature requests are pending", () => {
    expect(navigation()).not.toContain('visibility:hidden');
    expect(navigation()).toContain('href="/studio"');
    expect(navigation()).toContain('href="/batch-workbench"');
    expect(navigation()).not.toContain('aria-busy="true"');
  });

  it.each(["canvas", "agent"] as const)("keeps core navigation usable while %s is pending", (pending) => {
    status.canvas = { enabled: true, ready: pending !== "canvas" };
    status.agent = { enabled: false, ready: false, statusLoaded: pending !== "agent" };
    expect(navigation()).not.toContain('visibility:hidden');
    expect(navigation()).toContain('href="/studio"');
    expect(navigation()).toContain('href="/batch-workbench"');
  });

  it("reveals the complete configured order without waiting for Agent runtime availability", () => {
    status.canvas = { enabled: true, ready: true };
    status.agent = { enabled: false, ready: false, statusLoaded: true };
    const nav = navigation();
    expect(nav).not.toContain('visibility:hidden');
    expect(nav).not.toContain('aria-busy="true"');
    expect(nav.indexOf('href="/canvas"')).toBeLessThan(nav.indexOf('href="/materials"'));
    expect(nav).not.toContain('href="/agent"');
    expect(nav).not.toContain('href="/content-forge"');
  });

  it("continues to honor administrator feature changes after loading", () => {
    status.canvas = { enabled: true, ready: true };
    status.agent = { enabled: true, ready: true, statusLoaded: true };
    expect(navigation()).not.toContain('href="/agent"');
    expect(navigation()).not.toContain('href="/content-forge"');
    expect(navigation()).not.toContain('visibility:hidden');
    // 画布常开：侧边栏总是显示画布入口。
    expect(navigation()).toContain('href="/canvas"');
    expect(navigation()).not.toContain("data-canvas-entry-link");
  });
});
