// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BillingDraftsPanel from "@/components/admin/BillingDraftsPanel";
import BillingPriceList from "@/components/admin/BillingPriceList";
import { planPriceImport } from "@/lib/billing/migration";
import { validateDraft } from "@/lib/billing/drafts";
import type { BillingSettings } from "@/lib/billing/money";
import type { BillingModel } from "@/lib/billing/catalog";
vi.mock("next/navigation", () => ({ useSearchParams: () => null }));
import ModelCostsPanel from "@/components/admin/ModelCostsPanel";
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const draft = { provider: "platform-a", model: "model-a", module: "image", label: "模型 A", currency: "CNY", notes: "", rows: [{ conditions: {}, unitType: "image", price: "0" }] };
const models = ["a", "b", "c"].map((suffix) => ({ provider: "platform-a", providerName: "平台 A", model: `model-${suffix}`, label: `模型 ${suffix.toUpperCase()}`, module: "image", key: suffix, slots: [], rules: suffix === "c" ? [{ effectiveFrom: "2030-01-01" }] : [] })) as unknown as BillingModel[];
function button(text: string) { return [...host.querySelectorAll("button")].find((button) => button.textContent === text)!; }
async function selectFile(data: unknown) {
  const file = new File([JSON.stringify(data)], "prices.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(data) });
  const input = host.querySelector("input[type=file]")!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => Simulate.change(input));
}
it("counts models separately from versions, reports partial imports, and links to full export and publication", async () => {
  const settings: BillingSettings = { mode: "observe", revision: 0, rates: [] };
  const onPublish = vi.fn();
  function Harness() {
    const [drafts, setDrafts] = React.useState(settings.drafts || []);
    return React.createElement(BillingDraftsPanel, { embedded: true, models, drafts, busy: false, onEdit: vi.fn(), onEditRate: vi.fn(), onPublish, post: async (body) => {
      const plan = planPriceImport(body.file, settings, models, { image: "张" });
      if (body.action === "importDrafts") { settings.drafts = plan.drafts; setDrafts(plan.drafts); }
      return { ok: true, revision: 0, importReport: { items: plan.report.items.map((item) => body.action === "importDrafts" && item.status === "ready" ? { ...item, status: "imported" } : item) } };
    } });
  }
  await act(async () => root.render(React.createElement(Harness)));
  expect(host.querySelector('a[href="/api/admin/billing/catalog?export=all"]')).not.toBeNull();
  expect(host.querySelector('a[href="/api/admin/billing/catalog?export=migration"]')).not.toBeNull();
  expect(button("设置生效日期").disabled).toBe(true);
  await selectFile({ format: "inkvia-price-drafts-v1", drafts: [draft, { ...draft, notes: "second version" }, { ...draft, model: "missing" }, { ...draft, rows: [{ conditions: {}, unitType: "image", price: "-1" }] }] });
  const preview = host.querySelector('[aria-label="导入预览"]')!;
  expect(preview.textContent).toContain("可导入 · 1 个模型 · 2 个价格版本");
  expect(preview.textContent).toContain("已跳过 · 1 个模型 · 1 个价格版本");
  expect(preview.textContent).toContain("导入失败 · 1 个模型 · 1 个价格版本");
  expect(preview.textContent).toContain("平台 A · 模型 A");
  expect(settings.drafts).toBeUndefined();
  await act(async () => button("确认导入可用内容").click());
  expect(host.querySelector('[aria-label="导入结果"]')?.textContent).toContain("已导入 · 1 个模型 · 2 个价格版本");
  expect(host.textContent).toContain("尚未录入价格 · 1 个模型");
  expect(host.textContent).not.toMatch(/\d+\s*份/);
  expect(settings.drafts).toHaveLength(2);
  expect(button("设置生效日期").disabled).toBe(false);
  await act(async () => button("设置生效日期").click());
  expect(onPublish).toHaveBeenCalledOnce();
});
it("preserves blank drafts as unrecorded and makes unavailable-only imports non-actionable", async () => {
  const blank = validateDraft({ ...draft, rows: [{ conditions: {}, unitType: "image", price: "" }] });
  await act(async () => root.render(React.createElement(BillingDraftsPanel, { embedded: true, models, drafts: [blank], busy: false, onEdit: vi.fn(), onEditRate: vi.fn(), onPublish: vi.fn(), post: async (body) => ({ ok: true, revision: 0, importReport: planPriceImport(body.file, { mode: "observe", rates: [], revision: 0 }, models, { image: "张" }).report }) })));
  expect(host.textContent).toContain("尚未录入价格 · 2 个模型");
  expect(host.textContent).toContain("已填写 0 条规则 · 未填写 1 条规则");
  expect(button("设置生效日期").disabled).toBe(true);
  await selectFile({ format: "inkvia-price-drafts-v1", drafts: [{ ...draft, model: "missing" }] });
  expect(button("确认导入可用内容").disabled).toBe(true);
  expect(host.textContent).toContain("目标环境未接入");
});

it("compares current and draft tariffs in model columns, keeps units distinct, and searches across providers", async () => {
  const current = { currency: "CNY", unitPrice: "0.000123", unitType: "image", effectiveFrom: "2026-01-01T00:00:00.000Z" };
  const pending = validateDraft({ ...draft, rows: [
    { conditions: { resolution: "2K" }, unitType: "image", price: "0.8" },
    { conditions: { resolution: "4K", generateAudio: false }, unitType: "image", price: "" },
  ] });
  const listModels = [{ ...models[0], rules: [current, { ...current, unitPrice: "999", effectiveFrom: "2030-01-01" }], slots: [
    { key: "2K", label: "分辨率 2K", conditions: { resolution: "2K" }, unitType: "image", rule: current },
    { key: "4K", label: "分辨率 4K", conditions: { resolution: "4K" }, unitType: "image", missing: "缺价格" },
  ] }, { ...models[1], provider: "platform-b", providerName: "平台 B", slots: [
    { key: "input", label: "输入", conditions: {}, unitType: "input_million_token", rule: { ...current, currency: "USD", unitPrice: "0", unitType: "input_million_token" }, missing: "缺换算规则" },
  ] }];
  const onEdit = vi.fn();
  await act(async () => root.render(React.createElement(BillingPriceList, {
    models: listModels, drafts: [pending], units: { image: "每张", input_million_token: "每百万输入 token" },
    busy: false, onEditModel: vi.fn(), onEditDraft: onEdit, onManageDrafts: vi.fn(),
  })));
  expect(host.querySelectorAll("table")).toHaveLength(2);
  const rows = () => [...host.querySelectorAll("tbody tr")];
  expect(rows()).toHaveLength(3);
  expect(host.querySelector('table[aria-label="图片 · CNY · 每张"]')).not.toBeNull();
  expect(rows()[0].querySelector("td")?.textContent).toBe("0.000123/0.8");
  expect(rows()[1].textContent).toContain("待补");
  expect(host.textContent).not.toContain("999");
  const pendingButtons = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label*="待生效草稿"]')];
  expect(pendingButtons).toHaveLength(2);
  expect(pendingButtons[1].textContent).toContain("未填");
  expect(rows()[1].textContent).toContain("生成音频 无");
  expect(pendingButtons.every((item) => !item.getAttribute("aria-label")!.includes("生效日期"))).toBe(true);
  expect(host.querySelector('button[aria-label*="USD 0"]')?.textContent).toBe("0缺换算规则");
  await act(async () => pendingButtons[0].click());
  expect(onEdit).toHaveBeenCalledWith(listModels[0], pending);
  const search = host.querySelector<HTMLInputElement>('[aria-label="搜索价格清单"]')!;
  await act(async () => Simulate.change(search, { target: { value: "平台 B" } } as any));
  expect(rows()).toHaveLength(1);
  expect(host.querySelector("thead")?.textContent).toContain("平台 B");
  await act(async () => Simulate.change(search, { target: { value: " MODEL-A " } } as any));
  expect(rows()).toHaveLength(2);
  expect(host.querySelector('a[href="/api/admin/billing/catalog?export=all"]')).not.toBeNull();
  expect(host.querySelector('a[href="/api/admin/billing/catalog?export=migration"]')).not.toBeNull();
});

it("shows source gaps when previewing a migration file without filling zero prices", async () => {
  await act(async () => root.render(React.createElement(BillingDraftsPanel, { embedded: true, models, drafts: [], busy: false,
    onEdit: vi.fn(), onEditRate: vi.fn(), onPublish: vi.fn(), post: async (body) => ({ ok: true, revision: 0,
      importReport: planPriceImport(body.file, { mode: "observe", rates: [], revision: 0 }, models, { image: "张" }).report }) })));
  await selectFile({ format: "inkvia-prices-v2", purpose: "current-price-migration", drafts: [draft], prices: [], rates: [], rateDrafts: [],
    missing: [{ provider: "platform-a", model: "model-b", slot: "2K", reason: "缺价格" }] });
  expect(host.querySelector('[role="status"]')?.textContent).toContain("来源环境有 1 个档位缺价格或换算规则");
  expect(host.querySelector('[aria-label="导入预览"]')?.textContent).toContain("1 条已填写规则");
});

it("opens the full price list in a tab after monthly usage and preserves access to model editing", async () => {
  sessionStorage.clear();
  const rule = { id: "current-rule", currency: "CNY", unitPrice: "0.25", unitType: "image", effectiveFrom: "2026-01-01T00:00:00.000Z" };
  const model = { ...models[0], complete: false, rules: [rule], slots: [{ key: "2K", label: "分辨率 2K", conditions: { resolution: "2K" }, unitType: "image", rule }] };
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ settings: { mode: "observe", revision: 0, rates: [], drafts: [validateDraft(draft)] }, models: [model], units: { image: "每张" } }) }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    await act(async () => root.render(React.createElement(ModelCostsPanel)));
    const nav = host.querySelector('[aria-label="费用页面"]')!;
    expect([...nav.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["模型价格", "月度消耗", "价格清单"]);
    await act(async () => button("价格清单").click());
    expect(button("价格清单").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="模型价格明细"] button[aria-label*="CNY 0.25"]')?.textContent).toBe("0.25");
    expect(host.querySelector('[aria-label="模型价格明细"] button[aria-label*="待生效草稿"]')?.textContent).toBe("草稿0");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const currentPrice = host.querySelector<HTMLButtonElement>('[aria-label="模型价格明细"] button[aria-label*="CNY 0.25"]')!;
    await act(async () => currentPrice.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect([...dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')].some((input) => input.value === "0.25")).toBe(true);
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "取消")!.click());
    await act(async () => button("模型价格").click());
    expect(host.querySelector('[aria-label="模型价格明细"]')).toBeNull();
    expect(button("设置生效日期")).toBeDefined();
  } finally {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  }
});
