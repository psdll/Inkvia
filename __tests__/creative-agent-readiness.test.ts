import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  setting: vi.fn(),
  route: vi.fn(),
  catalog: vi.fn(),
  canvas: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  default: { appSetting: { findUnique: mocks.setting } },
}));
vi.mock("@/lib/creative-agent/model-catalog", () => ({ resolveCreativeAgentModel: mocks.route, getCreativeAgentChatModels: mocks.catalog }));
import {
  evaluateCreativeAgentRuntimeReadiness,
  getCreativeAgentCapabilities,
  getCreativeAgentRuntimeReadiness,
} from "@/lib/creative-agent/config";
const now = new Date("2026-10-13T12:00:00Z");
const valid = {
  now,
  heartbeatValue: JSON.stringify({
    successAt: "2026-10-13T11:59:50Z",
    protocolVersion: 1,
  }),
  llmStatus: "ready" as const,
  llmProtocol: "openai-chat",
  nodeMajor: 20,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.canvas.mockResolvedValue(true);
  mocks.catalog.mockResolvedValue([{ providerId: "test", modelId: "selected" }]);
  mocks.route.mockResolvedValue({
    status: "ready",
    route: { protocol: "openai-chat" },
  });
  mocks.setting.mockImplementation(
    async ({ where }: { where: { key: string } }) => ({
      value:
        where.key === "agent_entry_enabled"
          ? "1"
          : JSON.stringify({
              successAt: new Date().toISOString(),
              protocolVersion: 1,
            }),
    }),
  );
});
describe("new Agent shared runtime readiness", () => {
  it("opens the entry with available models and no platform default", async () => {
    mocks.route.mockResolvedValue({ status: "missing-binding" });
    expect(await getCreativeAgentCapabilities()).toMatchObject({ enabled: true, ready: true });
    expect(mocks.route).not.toHaveBeenCalled();
  });
  it("requires at least one usable model, but validates explicit selections independently", async () => {
    mocks.catalog.mockResolvedValue([]);
    expect(await getCreativeAgentCapabilities()).toMatchObject({ ready: false });
    const model = { providerId: "test", modelId: "chosen" };
    expect(await getCreativeAgentCapabilities(model)).toMatchObject({ ready: true });
    expect(mocks.route).toHaveBeenCalledWith(model);
  });
  it("requires a current protocol heartbeat, compatible model route and Node 20", () => {
    expect(evaluateCreativeAgentRuntimeReadiness(valid)).toEqual({
      worker: "ready",
      llm: "ready",
      ready: true,
      reason: null,
    });
    expect(
      evaluateCreativeAgentRuntimeReadiness({ ...valid, nodeMajor: 18 }),
    ).toMatchObject({
      ready: false,
      reason: "Agent 需要 Node.js 20 或更高版本",
    });
    expect(
      evaluateCreativeAgentRuntimeReadiness({
        ...valid,
        llmProtocol: "anthropic",
      }),
    ).toMatchObject({ ready: false });
    expect(
      evaluateCreativeAgentRuntimeReadiness({
        ...valid,
        llmStatus: "missing-binding",
      }),
    ).toMatchObject({ ready: false });
  });
  it.each([
    null,
    "{",
    JSON.stringify({ successAt: now.toISOString(), protocolVersion: 2 }),
    JSON.stringify({ successAt: "2026-10-13T12:01:00Z", protocolVersion: 1 }),
  ])(
    "rejects missing, invalid, foreign, and future heartbeat %s",
    (heartbeatValue) => {
      expect(
        evaluateCreativeAgentRuntimeReadiness({ ...valid, heartbeatValue }),
      ).toMatchObject({ worker: "missing", ready: false });
    },
  );
  it("reports stale worker truthfully", () => {
    expect(
      evaluateCreativeAgentRuntimeReadiness({
        ...valid,
        heartbeatValue: JSON.stringify({
          successAt: "2026-10-13T11:50:00Z",
          protocolVersion: 1,
        }),
      }),
    ).toMatchObject({ worker: "stale", ready: false });
  });
  it("keeps the canvas and its Agent always on without reading any switch", async () => {
    mocks.setting.mockResolvedValue({ value: "0" });
    mocks.route.mockResolvedValue({ status: "missing-binding" });
    expect(await getCreativeAgentCapabilities()).toMatchObject({ enabled: true });
    expect(
      mocks.setting.mock.calls.some(([input]) => ["agent_entry_enabled", "canvas_entry_enabled"].includes(input.where.key)),
    ).toBe(false);
  });
});
