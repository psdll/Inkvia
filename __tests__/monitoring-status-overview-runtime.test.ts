/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonitoringStatusOverview } from "@/components/admin/monitoring/MonitoringStatusOverview";
import type { ServiceStatus } from "@/lib/monitoring/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const services = ["web", "nginx", "generation-worker", "media-worker", "live-video-prompt-worker", "live-video-video-worker", "postgresql"].map((id) => ({
  id, state: "healthy", name: id, controllable: false, updatedAt: new Date().toISOString(),
})) as ServiceStatus[];
let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

function mount(extra: Partial<React.ComponentProps<typeof MonitoringStatusOverview>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(React.createElement(MonitoringStatusOverview, {
    mode: "production", services, hostState: "healthy", serverEvents: [],
    resourceTriggerRef: React.createRef<HTMLButtonElement>(), onNavigate: vi.fn(), ...extra,
  })));
  dispose = () => { act(() => root.unmount()); host.remove(); };
  return host;
}

describe("monitoring overview evidence and alert visibility", () => {
  it("keeps active alerts visible even when all core services are healthy", () => {
    const onOpenAlerts = vi.fn();
    const host = mount({ activeAlertCount: 2, onOpenAlerts });
    expect(host.textContent).toContain("核心功能运行正常");
    expect(host.textContent).toContain("2 条活动告警待查看");
    expect(host.textContent).not.toContain("当前未检测到需要处理的问题");
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    expect(onOpenAlerts).toHaveBeenCalledTimes(1);
  });

  it("does not present old healthy evidence while loading", () => {
    const host = mount({ pending: true, activeAlertCount: 2 });
    expect(host.textContent).toContain("正在读取当前资源状态");
    expect(host.textContent).not.toContain("运行正常");
    expect(host.textContent).not.toContain("当前未检测到需要处理的问题");
  });

  it("keeps local monitoring limitations explicit", () => {
    const host = mount({ mode: "local-light", services: [services[0]] });
    expect(host.textContent).toContain("未开启检测");
    expect(host.textContent).not.toContain("4 / 4");
  });
});
