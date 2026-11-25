import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AtomicPageReveal runtime", () => {
  it("keeps page content visible while business readiness is pending", async () => {
    const onReveal = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(
        AtomicPageReveal,
        {
          ready: false,
          onReveal,
          children: React.createElement("button", null, "usable shell"),
        },
      ));
    });

    expect(host.textContent).toContain("usable shell");
    expect(host.querySelector(".atomic-page-reveal__cover")).toBeNull();
    expect(host.querySelector("[data-page-reveal-state]")?.getAttribute("data-page-reveal-state")).toBe("pending");
    expect(host.querySelector("[data-page-reveal-state]")?.getAttribute("aria-busy")).toBe("true");
    expect(onReveal).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("notifies business readiness once without gating child visibility", async () => {
    const onReveal = vi.fn();
    const readyEvent = vi.fn();
    window.addEventListener("app:page-reveal-ready", readyEvent);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(
        AtomicPageReveal,
        {
          ready: false,
          onReveal,
          children: React.createElement("span", null, "workspace"),
        },
      ));
    });

    expect(host.textContent).toContain("workspace");
    expect(onReveal).not.toHaveBeenCalled();
    expect(readyEvent).not.toHaveBeenCalled();

    await act(async () => {
      root.render(React.createElement(
        AtomicPageReveal,
        {
          ready: true,
          onReveal,
          children: React.createElement("span", null, "workspace"),
        },
      ));
    });

    expect(host.querySelector("[data-page-reveal-state]")?.getAttribute("data-page-reveal-state")).toBe("ready");
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(readyEvent).toHaveBeenCalledTimes(1);
    window.removeEventListener("app:page-reveal-ready", readyEvent);
    await act(async () => root.unmount());
  });
});
