import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: new Map<number, any>(), task: vi.fn(), save: vi.fn(), ledger: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const matches = (r: any, w: any): boolean => Object.entries(w || {}).every(([key, value]: any) => {
    if (key === "AND") return value.every((v: any) => matches(r, v));
    if (value instanceof Date) return r[key]?.getTime() === value.getTime();
    if (value && typeof value === "object") {
      if (value.in) return value.in.includes(r[key]);
      if (value.contains) return String(r[key] || "").includes(value.contains);
    }
    return r[key] === value;
  });
  const db: any = { generation: {
    findUnique: vi.fn(async ({where}) => structuredClone(m.rows.get(where.id) || null)),
    findFirst: vi.fn(async ({where}) => structuredClone([...m.rows.values()].find(r => matches(r,where)) || null)),
    updateMany: vi.fn(async ({where,data}) => { let count = 0; for (const [id,r] of m.rows) if (matches(r,where)) { m.rows.set(id,{...r,...data});count++; } return {count}; }),
    create: vi.fn(async ({data}) => { const r = {...data,id: 901 + m.rows.size, createdAt: new Date(),updatedAt:new Date()}; m.rows.set(r.id,r);return r; }),
  } };
  db.$transaction = async (fn: any) => fn(db);
  return { default: db };
});
vi.mock("@/lib/suno", () => ({ getSunoTask: m.task }));
vi.mock("@/lib/storage", () => ({ saveRemoteFileWithHash: m.save }));
vi.mock("@/lib/generation-display-assets", () => ({ createGenerationDisplayAssetPatch: vi.fn(async () => ({})) }));
vi.mock("@/lib/creative-agent/debug-generation", () => ({ withGenerationDebug: (_: any, fn: any) => fn() }));
vi.mock("@/lib/maintenance", () => ({ runGenerationCompletionCreate: (fn: any) => fn() }));
vi.mock("@/lib/billing-ledger", () => ({ upsertUsageLedgerForGeneration: m.ledger, upsertUsageLedgerForGenerationId: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-asset-feed", () => ({ upsertAdminAssetFeedForRows: vi.fn(async () => undefined), upsertAdminAssetFeedForGenerationId: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ Logger: { generation: vi.fn(async () => undefined), error: vi.fn(async () => undefined) } }));
import { finalizeGeneration } from "@/lib/generation/finalize";
import { getCanvasGenerationOutputs } from "@/lib/canvas/generation-outputs";
const payload = { data: { status: "completed", result: { music: [
  { title: "一", audio_url: "https://cdn.test/same.mp3", image_url: "https://cdn.test/cover.jpg", duration: 21.2 },
  { title: "二", audio_url: "https://cdn.test/same.mp3", duration: 22.3, lyrics: "歌词二" },
  { title: "三", audio_url: "https://cdn.test/third.mp3", duration: 23.4 },
] } } };
describe("Suno durable multi-track finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.rows.clear(); m.ledger.mockResolvedValue(undefined);
    m.rows.set(900, { id:900,userId:"7",authUserId:7,canvasId:12,type:"audio_gen",source:"canvas",model:"suno-v6-apimart",status:"running",externalProvider:"apimart",externalTaskId:"music-900",localPath:null,templateData:JSON.stringify({billing:{unitType:"request",childBillable:false}}),createdAt:new Date(),updatedAt:new Date() });
    m.task.mockResolvedValue(payload);
    m.save.mockImplementation(async (url: string) => ({ localPath: `/uploads/${url.split("/").at(-1)}`,hash:url }));
  });
  it("saves all tracks, local covers, original indices and non-billable child identities", async () => {
    expect(await finalizeGeneration(900)).toBe("done");
    const parent = m.rows.get(900); expect(parent.status).toBe("success");
    const outputs = getCanvasGenerationOutputs(parent);
    expect(outputs).toHaveLength(3);
    expect(outputs.map(o => o.suno?.audioIndex)).toEqual([1,2,3]);
    expect(outputs.map(o => o.suno?.taskId)).toEqual(["music-900","music-900","music-900"]);
    expect(outputs[0].suno?.coverUrl).toBe("/uploads/cover.jpg");
    expect(new Set(outputs.map(o=>o.generationId)).size).toBe(3);
    expect([...m.rows.values()].filter(r=>r.id!==900).every(r=>JSON.parse(r.templateData).billing.billable===false)).toBe(true);
    expect(m.rows.size).toBe(3);
    expect(await finalizeGeneration(900)).toBe("skipped");
    expect(m.task).toHaveBeenCalledTimes(1);
  });
  it("resumes only unsaved tracks after a download interruption", async () => {
    let failed = false;
    m.save.mockImplementation(async (url:string) => { if (url.endsWith("third.mp3") && !failed) {failed=true;throw new Error("connection reset");} return {localPath:`/uploads/${url.split("/").at(-1)}`,hash:url}; });
    expect(await finalizeGeneration(900)).toBe("pending");
    expect(JSON.parse(m.rows.get(900).templateData).savedOutputs).toHaveLength(2);
    expect(await finalizeGeneration(900)).toBe("done");
    expect(m.save.mock.calls.filter(([url])=>url.endsWith("same.mp3"))).toHaveLength(2);
    expect(getCanvasGenerationOutputs(m.rows.get(900))).toHaveLength(3);
  });
  it("keeps unknown upstream status pending even after the normal timeout", async () => {
    m.rows.get(900).createdAt = new Date(Date.now()-86_400_000);
    m.task.mockResolvedValue({data:{status:"unknown"}});
    expect(await finalizeGeneration(900)).toBe("pending");
    expect(m.rows.get(900).status).toBe("running"); expect(m.rows.get(900).externalTaskId).toBe("music-900");
  });
  it("never converts an ambiguous missing receipt to a retryable failure", async () => {
    Object.assign(m.rows.get(900), { externalTaskId:null, createdAt:new Date(0), templateData:JSON.stringify({phase:"submission_unknown"}) });
    expect(await finalizeGeneration(900)).toBe("skipped"); expect(m.task).not.toHaveBeenCalled();
    expect(m.rows.get(900).status).toBe("running");
  });
});
