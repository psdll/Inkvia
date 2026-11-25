import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), submit: vi.fn(), visible: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { generation: { findFirst: m.findFirst, create: m.create, update: m.update } } }));
vi.mock("@/lib/billing/admission", () => ({ assertBillingReady: vi.fn() }));
vi.mock("@/lib/runtime-generation-budget", () => ({ reserveRuntimeGeneration: vi.fn() }));
vi.mock("@/lib/billing-ledger", () => ({ upsertUsageLedgerForGenerationId: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-asset-feed", () => ({ upsertAdminAssetFeedForGenerationId: vi.fn(async () => undefined) }));
vi.mock("@/lib/image-edit-models", () => ({ isAudioModelVisible: m.visible }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: vi.fn(async () => []) }));
vi.mock("@/lib/providers/model-availability", () => ({ isProviderModelEnabled: m.enabled }));
vi.mock("@/lib/suno", () => ({ submitSuno: m.submit, SunoRequestError: class extends Error { constructor(message: string, public rejected: boolean) { super(message); } } }));
import { createAudioGeneration } from "@/lib/generation/audio-service";
import { SunoRequestError } from "@/lib/suno";
const input = { authUserId: 29, requestKey: "suno-request", source: "canvas" as const, model: "suno-v6-apimart", text: "温暖钢琴", suno: { description: "温暖钢琴" } };
describe("Suno submission receipts", () => {
  beforeEach(() => { vi.clearAllMocks(); m.findFirst.mockResolvedValue(null); m.create.mockImplementation(async ({data}) => ({ id: 900, ...data })); m.update.mockResolvedValue({ id: 900 }); m.visible.mockResolvedValue(true); m.enabled.mockReturnValue(true); m.submit.mockResolvedValue("suno-task"); });
  it("persists the request before POST and records one billable request", async () => {
    expect(await createAudioGeneration(input)).toMatchObject({ generationId: 900, status: "running" });
    expect(m.create.mock.invocationCallOrder[0]).toBeLessThan(m.submit.mock.invocationCallOrder[0]);
    expect(JSON.parse(m.create.mock.calls[0][0].data.templateData)).toMatchObject({ maxMode: false, billing: { unitType: "request", childBillable: false } });
    expect(m.update.mock.calls[0][0].data.externalTaskId).toBe("suno-task");
  });
  it("reuses an existing uncertain receipt without resubmitting", async () => {
    m.findFirst.mockResolvedValue({ id: 900, status: "running", localPath: null, templateData: JSON.stringify({ phase: "submission_unknown" }) });
    expect(await createAudioGeneration(input)).toMatchObject({ generationId: 900, status: "running" });
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("keeps ambiguous timeouts pending without retrying the paid POST", async () => {
    m.submit.mockRejectedValue(new Error("network timeout"));
    expect(await createAudioGeneration(input)).toMatchObject({ status: "running" });
    expect(m.submit).toHaveBeenCalledTimes(1);
    expect(JSON.parse(m.update.mock.calls[0][0].data.templateData).phase).toBe("submission_unknown");
  });
  it("retries a failed receipt write only", async () => {
    m.update.mockRejectedValueOnce(new Error("db unavailable"));
    await createAudioGeneration(input);
    expect(m.submit).toHaveBeenCalledTimes(1); expect(m.update).toHaveBeenCalledTimes(2);
  });
  it("marks a confirmed rejection failed", async () => {
    m.submit.mockRejectedValue(new SunoRequestError("invalid lyrics", true));
    await expect(createAudioGeneration(input)).rejects.toThrow("invalid lyrics");
    expect(m.update.mock.calls[0][0].data.status).toBe("failed");
  });
  it("refuses disabled models before submitting", async () => {
    m.enabled.mockReturnValue(false);
    await expect(createAudioGeneration(input)).rejects.toThrow("不可用");
    expect(m.submit).not.toHaveBeenCalled();
  });
});
