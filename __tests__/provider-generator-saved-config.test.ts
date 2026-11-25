import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosWithProviderEgress: vi.fn(),
  fetchWithProviderEgress: vi.fn(),
  resolveProviderRequestContext: vi.fn(),
}));

vi.mock("@/lib/providers/transport", () => ({
  axiosWithProviderEgress: mocks.axiosWithProviderEgress,
  fetchWithProviderEgress: mocks.fetchWithProviderEgress,
  resolveProviderRequestContext: mocks.resolveProviderRequestContext,
}));

import { easyRouterGenerateImage } from "@/lib/easyrouter-image";
import { jiekouGptImage2Generate } from "@/lib/jiekou-image";
import { kieCreateTask, kieGetTaskDetail } from "@/lib/kie";
import { seedanceCreateTask, seedanceGetTask } from "@/lib/seedance";
import { volcSeedreamGenerate } from "@/lib/volcengine";

const ORIGINAL_ENV = { ...process.env };

function savedProvider(id: string) {
  return {
    id,
    name: id,
    baseUrl: `https://saved-${id}.example/root`,
    apiKey: `saved-${id}-key`,
  };
}

function directDecision(id: string) {
  return { providerId: id, mode: "direct", cacheKey: "direct" };
}

function savedContext(id: string) {
  return { provider: savedProvider(id), decision: directDecision(id) };
}

function proxyContext(id: string) {
  return {
    provider: savedProvider(id),
    decision: {
      providerId: id,
      mode: "proxy",
      cacheKey: "proxy-fingerprint",
      agentSlot: "database",
      proxyUri: "http://127.0.0.1:7890",
    },
  };
}

describe("built-in generation adapters use saved provider endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProviderRequestContext.mockImplementation(async (id: string) => savedContext(id));
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });



  it("uses the saved KIE base URL and image-generation key for create and polling", async () => {
    mocks.axiosWithProviderEgress
      .mockResolvedValueOnce({ status: 200, data: { code: 200, data: { taskId: "kie-task" } } })
      .mockResolvedValueOnce({
        status: 200,
        data: { code: 200, data: { taskId: "kie-task", state: "success" } },
      });

    await kieCreateTask({ model: "image" });
    await kieGetTaskDetail("kie-task");

    expect(mocks.axiosWithProviderEgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: "kie", mode: "direct" }),
      expect.objectContaining({
        url: "https://saved-kie.example/root/api/v1/jobs/createTask",
        headers: expect.objectContaining({ Authorization: "Bearer saved-kie-key" }),
        timeout: 45000,
      }),
    );
    expect(mocks.axiosWithProviderEgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ providerId: "kie", mode: "direct" }),
      expect.objectContaining({
        url: "https://saved-kie.example/root/api/v1/jobs/recordInfo",
        headers: { Authorization: "Bearer saved-kie-key" },
      }),
    );
  });

  it("does not automatically retry a billable KIE create request", async () => {
    mocks.axiosWithProviderEgress.mockResolvedValue({
      status: 503,
      data: { code: 503, message: "temporarily unavailable" },
    });

    await expect(kieCreateTask({ model: "image" })).rejects.toThrow();

    expect(mocks.axiosWithProviderEgress).toHaveBeenCalledOnce();
  });

  it("uses the saved EasyRouter endpoint and key for image generation", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ url: "https://cdn.example/easyrouter.png" }] }), { status: 200 }),
    );

    const result = await easyRouterGenerateImage({ model: "image 2", prompt: "draw" });

    expect(result.images).toEqual(["https://cdn.example/easyrouter.png"]);
    expect(mocks.resolveProviderRequestContext).toHaveBeenCalledWith("easyrouter");
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "easyrouter", mode: "direct" }),
      "https://saved-easyrouter.example/root/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer saved-easyrouter-key",
          "Content-Type": "application/json",
        }),
        body: expect.stringContaining('"model":"gpt-image-2"'),
      }),
    );
  });

  it("does not automatically retry an interrupted billable EasyRouter request", async () => {
    mocks.fetchWithProviderEgress.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(easyRouterGenerateImage({ model: "image 2", prompt: "draw" })).rejects.toThrow("ECONNRESET");

    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledOnce();
  });

  it("reports an unknown EasyRouter outcome without replaying an interrupted proxied request", async () => {
    mocks.resolveProviderRequestContext.mockResolvedValueOnce(proxyContext("easyrouter"));
    mocks.fetchWithProviderEgress.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(easyRouterGenerateImage({ model: "image 2", prompt: "draw" }))
      .rejects.toThrow("上游可能已完成并计费");

    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledOnce();
  });

  it("uses the saved Volcengine endpoint and key for model discovery and image generation", async () => {
    mocks.fetchWithProviderEgress
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: "https://cdn.example/volc.png" }] }), { status: 200 }));

    await volcSeedreamGenerate({ model: "doubao-seedream-5-0", prompt: "draw" });

    expect(mocks.fetchWithProviderEgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: "volcengine", mode: "direct" }),
      "https://saved-volcengine.example/root/api/v3/models",
      expect.objectContaining({ headers: { Authorization: "Bearer saved-volcengine-key" } }),
    );
    expect(mocks.fetchWithProviderEgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ providerId: "volcengine", mode: "direct" }),
      "https://saved-volcengine.example/root/api/v3/images/generations",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer saved-volcengine-key" }) }),
    );
  });

  it("uses the saved Volcengine endpoint and key for Seedance create and polling", async () => {
    mocks.axiosWithProviderEgress
      .mockResolvedValueOnce({ status: 200, data: { id: "seedance-task", status: "submitted" } })
      .mockResolvedValueOnce({ status: 200, data: { id: "seedance-task", status: "succeeded" } });

    await seedanceCreateTask({
      model: "doubao-seedance-2-0-260128",
      prompt: "video",
      inputMode: "text_to_video",
    });
    await seedanceGetTask("seedance-task");

    expect(mocks.axiosWithProviderEgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: "volcengine", mode: "direct" }),
      expect.objectContaining({
        url: "https://saved-volcengine.example/root/api/v3/contents/generations/tasks",
        headers: expect.objectContaining({ Authorization: "Bearer saved-volcengine-key" }),
        timeout: 60000,
      }),
    );
    expect(mocks.axiosWithProviderEgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ providerId: "volcengine", mode: "direct" }),
      expect.objectContaining({
        url: "https://saved-volcengine.example/root/api/v3/contents/generations/tasks/seedance-task",
        headers: expect.objectContaining({ Authorization: "Bearer saved-volcengine-key" }),
        timeout: 30000,
      }),
    );
  });

  it("requires an admin-saved key even when legacy environment keys exist", async () => {
    process.env.KIE_API_KEY = "env-kie-key";
    process.env.KIE_LLM_API_KEY = "llm-only-key";
    mocks.resolveProviderRequestContext.mockImplementation(async (id: string) => ({
      provider: {
        ...savedProvider(id),
        apiKey: "",
      },
      decision: directDecision(id),
    }));

    await expect(kieCreateTask({ model: "image" })).rejects.toThrow("API Key");

    expect(mocks.axiosWithProviderEgress).not.toHaveBeenCalled();
  });

  it("redacts reflected KIE response errors", async () => {
    mocks.axiosWithProviderEgress
      .mockResolvedValueOnce({
        status: 400,
        data: { code: 400, message: "saved-kie-key https://saved-kie.example/root/api/v1/jobs/createTask" },
      });

    const kieError = await kieCreateTask({ model: "image" }).catch((error) => error);

    for (const [error, secret, host] of [
      [kieError, "saved-kie-key", "saved-kie.example"],
    ]) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error?.message)).not.toContain(secret);
      expect(String(error?.message)).not.toContain(host);
    }
  });

  it("redacts reflected Jiekou and Volcengine response errors", async () => {
    mocks.fetchWithProviderEgress.mockImplementation(async (_decision: unknown, url: string) => {
      const provider = url.includes("saved-jiekou") ? "jiekou" : "volcengine";
      const secret = `saved-${provider}-key`;
      return new Response(JSON.stringify({ error: { message: `${secret} ${url}` } }), { status: 502 });
    });

    const jiekouError = await jiekouGptImage2Generate({ prompt: "draw" }).catch((error) => error);
    const volcError = await volcSeedreamGenerate({ model: "doubao-seedream-5-0", prompt: "draw" }).catch((error) => error);

    for (const [error, secret, host] of [
      [jiekouError, "saved-jiekou-key", "saved-jiekou.example"],
      [volcError, "saved-volcengine-key", "saved-volcengine.example"],
    ]) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error?.message)).not.toContain(secret);
      expect(String(error?.message)).not.toContain(host);
    }
  });

  it("sanitizes task-failed fields", async () => {
    mocks.axiosWithProviderEgress
      .mockResolvedValueOnce({
        status: 200,
        data: {
          id: "seedance-task",
          status: "failed",
          error_message: "saved-volcengine-key https://saved-volcengine.example/private",
        },
      });

    const seedance = await seedanceGetTask("seedance-task");

    expect(JSON.stringify(seedance)).not.toContain("saved-volcengine-key");
    expect(JSON.stringify(seedance)).not.toContain("saved-volcengine.example/private");
  });
});
