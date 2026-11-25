/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */

import * as React from "react";
import { readFileSync } from "node:fs";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FrostedSelect } from "@/components/ui/frosted-select";

const domKeys = [[Element.prototype, 'scrollIntoView'], [HTMLCanvasElement.prototype, 'getContext']] as const;
const originalDom = domKeys.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
afterAll(() => { vi.unstubAllGlobals(); domKeys.forEach(([target, key], i) => { const descriptor=originalDom[i]; if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); }); });
beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = () => undefined;
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: (text: string) => ({ width: text.length * 8 }),
  })) as any;
});

describe("works source filter style", () => {
  it("uses the assets toolbar treatment for the trigger and dropdown", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(FrostedSelect, {
          value: "creation",
          onChange: () => undefined,
          options: [
            { value: "creation", label: "全部创作" },
            { value: "tool", label: "创作" },
          ],
          variant: "toolbar",
          showOptionLeading: false,
          renderLeading: () => React.createElement("span", { "data-leading": "true" }),
        } as React.ComponentProps<typeof FrostedSelect>),
      );
    });

    const trigger = host.querySelector("button") as HTMLButtonElement;
    expect(trigger.className).toContain("rounded-2xl");
    expect(trigger.className).toContain("bg-white/28");
    expect(trigger.className).toContain("backdrop-blur-lg");
    expect(trigger.className).not.toContain("focus:ring-2");
    expect(trigger.querySelector('[data-leading="true"]')).not.toBeNull();

    await act(async () => trigger.click());

    const menu = document.body.querySelector('[data-frosted-select-menu]') as HTMLDivElement;
    const selectedOption = menu.querySelector('[role="option"][aria-selected="true"]') as HTMLButtonElement;
    expect(menu.className).toContain("backdrop-blur-xl");
    expect(menu.className).not.toContain("select-dropdown-panel");
    expect(menu.firstElementChild?.className).toContain("p-1");
    expect(selectedOption.className).toContain("bg-slate-50/70");
    expect(selectedOption.className).toContain("text-sm");
    expect(selectedOption.querySelector('[data-leading="true"]')).toBeNull();
    expect(selectedOption.textContent).toBe('全部创作');
    expect(selectedOption.querySelector('svg')).toBeNull();
    const next = menu.querySelector<HTMLButtonElement>('[role="option"][aria-selected="false"]')!;
    expect(next.textContent).toBe('创作');
    await act(async () => next.click());
    expect(document.body.querySelector('[data-frosted-select-menu]')).toBeNull();

    await act(async () => root.unmount());
    menu.remove();
    host.remove();
  });

  it("enables the toolbar variant only on the assets page", () => {
    const selectSource = readFileSync("components/ui/asset-source-select.tsx", "utf8");
    const worksPageSource = readFileSync("app/works/page.tsx", "utf8");

    expect(selectSource).toContain("variant?: FrostedSelectVariant");
    expect(selectSource).toContain("variant={variant}");
    expect(selectSource).toContain('showOptionLeading={variant !== "toolbar"}');
    expect(worksPageSource).toContain('variant="toolbar"');
  });
});
