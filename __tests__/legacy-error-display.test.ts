import { beforeEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/errors/legacy-input-limit-stack-overflow.json";
import { formatFriendlyMessageForStorage, friendlyErrorDisplayText, friendlyErrorPrimaryText, parseFriendlyMessageFromStorage, toFriendlyError } from "@/lib/error-friendly";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), createImage: vi.fn(), createVideo: vi.fn(), finalize: vi.fn(), recover: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { generation: { findFirst: mocks.findFirst } }, prisma: {} }));
vi.mock("@/lib/generation/image-service", () => ({ createImageGeneration: mocks.createImage }));
vi.mock("@/lib/generation/video-service", () => ({ createVideoGeneration: mocks.createVideo }));
vi.mock("@/lib/generation/finalize", () => ({ FINALIZE_PROVIDERS: ["google-ai-studio"], isInProgressStatus: (status: string) => ["pending", "running", "processing"].includes(status), finalizeGeneration: mocks.finalize, recoverStaleProcessingGeneration: mocks.recover }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn() }));
vi.mock("@/lib/canvas/generation-media", () => ({ getOrCreateGenerationMediaAsset: vi.fn() }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: vi.fn() }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentCanvas: vi.fn(), requireCreativeAgentEnabled: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ getUserId: async () => 1 }));
import { canAutomaticallyRetryMedia } from "@/lib/creative-agent/media-broker";
import { GET } from "@/app/api/canvas/generation/[id]/route";

const stored = fixture.generation.errorMsg;
const neutral = "任务处理时发生内部错误，请联系管理员核对结果。";
beforeEach(() => vi.clearAllMocks());
it.each([stored, stored.replace("\n\n[原始错误]", "\n[请求ID] demo-request-71\n\n[原始错误]")])("corrects only the stored stack mismatch while preserving cause/request ID", (value) => {
  const original = value;
  const parsed = parseFriendlyMessageFromStorage(value);
  expect(parsed.message).toBe(neutral);
  expect(parsed.action).not.toContain("减少输入");
  expect(parsed.raw).toBe("message=Maximum call stack size exceeded");
  expect(parsed.requestId).toBe(value.includes("[请求ID]") ? "demo-request-71" : null);
  expect(friendlyErrorPrimaryText(value)).toBe(neutral);
  expect(friendlyErrorDisplayText(value)).toBe(neutral);
  expect(value).toBe(original);
  expect(parsed.message + parsed.action).not.toMatch(/已完成|已生成|保存失败|不计费|安全重试/);
});
it.each(["Google AI Studio 图片模型最多支持 16 张参考图", "input image count exceeds limit 16", "too many input images"])('retains real count advice: %s', (raw) => {
  const parsed = parseFriendlyMessageFromStorage(formatFriendlyMessageForStorage(toFriendlyError(raw)));
  expect(parsed.message).toBe("输入数量超出当前模型限制。");
  expect(parsed.action).toBe("请减少输入数量后重试。");
  expect(parsed.raw).toBe(raw);
});
it.each([
  stored.replace("输入数量超出当前模型限制。", "请求参数不符合接口要求。"),
  stored.replace("\n\n[原始错误]\n", "\n"),
  stored.replace("Maximum call stack size exceeded", "Cache size exceeded"),
  stored.replace("Maximum call stack size exceeded", "Internal retry count exceeded"),
  formatFriendlyMessageForStorage(toFriendlyError("content policy rejected")),
  formatFriendlyMessageForStorage(toFriendlyError("unauthorized (401)")),
  formatFriendlyMessageForStorage(toFriendlyError("远程结果已返回，但下载保存失败")),
])("preserves unrelated formatted error and action: %s", (value) => {
  const parsed = parseFriendlyMessageFromStorage(value);
  expect(parsed.message).not.toBe(neutral);
  expect(friendlyErrorDisplayText(value)).toBe(value);
  if (value.includes("\n\n[原始错误]\n")) expect(parsed.raw).toBe(value.split("\n\n[原始错误]\n")[1]);
  else expect(parsed.raw).toContain("message=Maximum call stack size exceeded");
});
it("keeps actual legacy automatic-retry eligibility false with no dispatch", () => {
  expect(canAutomaticallyRetryMedia({ status: "failed", errorMsg: stored })).toBe(false);
  expect(mocks.createImage).not.toHaveBeenCalled();
  expect(mocks.createVideo).not.toHaveBeenCalled();
});
it("projects the stored failed generation through the real polling route without writes or finalization", async () => {
  const row = JSON.parse(JSON.stringify(fixture.generation));
  const before = JSON.stringify(row);
  mocks.findFirst.mockResolvedValue(row);
  const response = await GET(new Request(`http://localhost/api/canvas/generation/${row.id}`) as any, { params: { id: String(row.id) } });
  expect(await response.json()).toMatchObject({ status: "failed", outputs: [], url: null, error: neutral });
  expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: row.id, authUserId: 1 } }));
  expect(JSON.stringify(row)).toBe(before);
  expect(mocks.finalize).not.toHaveBeenCalled();
  expect(mocks.recover).not.toHaveBeenCalled();
  expect(mocks.createImage).not.toHaveBeenCalled();
  expect(mocks.createVideo).not.toHaveBeenCalled();
});
