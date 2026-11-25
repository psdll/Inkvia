import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AutoHideScrollbar } from "@/components/ui/auto-hide-scrollbar";

it("only controls visibility and leaves native scrolling and dragging untouched", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scroll = document.createElement("main");
  scroll.style.scrollBehavior = "smooth";
  scroll.scrollTop = 400;
  scroll.scrollTo = vi.fn();
  scroll.setPointerCapture = vi.fn();
  scroll.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 800, width: 800, height: 800, x: 0, y: 0, toJSON() {} });
  const host = document.createElement("div"); document.body.append(scroll, host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(AutoHideScrollbar, { scrollRef: { current: scroll } })));
    expect(host.childElementCount).toBe(0);
    expect(scroll.dataset.scrollbarActive).toBe("false");
    scroll.dispatchEvent(new Event("scroll"));
    expect(scroll.dataset.scrollbarActive).toBe("true");
    vi.advanceTimersByTime(800);
    expect(scroll.dataset.scrollbarActive).toBe("false");
    const move = new Event("pointermove", { cancelable: true });
    Object.assign(move, { clientX: 795 }); scroll.dispatchEvent(move);
    vi.advanceTimersByTime(1000);
    expect(scroll.dataset.scrollbarActive).toBe("true");
    expect(move.defaultPrevented).toBe(false);
    for (const type of ["pointerdown", "wheel", "keydown", "pointerup"]) {
      const event = new Event(type, { cancelable: true }); scroll.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    expect(scroll.setPointerCapture).not.toHaveBeenCalled();
    expect(scroll.scrollTop).toBe(400);
    expect(scroll.style.scrollBehavior).toBe("smooth");
    scroll.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(800);
    expect(scroll.dataset.scrollbarActive).toBe("false");
  } finally {
    await act(async () => root.unmount());
    expect(scroll.dataset.scrollbarActive).toBeUndefined();
    host.remove(); scroll.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});
