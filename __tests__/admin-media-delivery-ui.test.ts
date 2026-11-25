import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const snapshot = { success: true, mode: "platform", updatedAt: null, ossReady: true, pinnedByEnv: false, enabledPlatformIds: ["kie", "apimart", "volcengine"] };
vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: vi.fn(async () => ({ ok: true, json: snapshot })) }));

const { default: AdminMediaDeliverySection } = await import("@/components/admin/AdminMediaDeliverySection");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("admin media delivery section", () => {
  it("explains both modes, lists every platform's route, and saves the switch", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...snapshot, mode: "oss" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { root.render(React.createElement(AdminMediaDeliverySection)); });
    await act(async () => { await Promise.resolve(); });
    const text = host.textContent || "";
    expect(text).toContain("优先走各平台自带的临时图床");
    expect(text).toContain("全部走阿里云 OSS");
    for (const name of ["KIE.AI", "APIMART", "阿里云百炼官方", "火山引擎官方", "MiniMax", "OpenRouter", "海牙科技"]) expect(text).toContain(name);
    expect(text).toContain("平台自带图床");
    expect(text).toContain("Base64 直传");
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("平台自带");
    const ossOption = Array.from(host.querySelectorAll('[role="radio"]')).find((node) => node.textContent?.includes("全部走阿里云 OSS")) as HTMLButtonElement;
    await act(async () => { ossOption.click(); });
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/settings/media-delivery", expect.objectContaining({ method: "POST", body: JSON.stringify({ mode: "oss" }) }));
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("全部走阿里云 OSS");
    expect(host.textContent).toContain("当前为“全部走阿里云 OSS”");
  });
});
