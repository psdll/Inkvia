import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/apimart-image", () => ({ resolveApimartEndpoint: m.resolve }));
vi.mock("@/lib/providers/transport", () => ({ fetchWithProviderEgress: m.fetch }));
import { submitSuno, getSunoTask } from "@/lib/suno";
describe("Suno APIMart transport", () => {
  beforeEach(() => { vi.clearAllMocks(); m.resolve.mockResolvedValue({ base: "https://saved.test/v1", apiKey: "saved-key", decision: { providerId: "apimart", mode: "direct" } }); });
  it("uses the saved endpoint, Bearer key and music endpoint once", async () => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify({ code: 200, data: [{ task_id: "music-1" }] })));
    const body = { model: "suno", version: "v6", prompt: "warm piano" };
    expect(await submitSuno(body)).toBe("music-1");
    expect(m.fetch).toHaveBeenCalledTimes(1);
    expect(m.fetch).toHaveBeenCalledWith(expect.anything(), "https://saved.test/v1/music/generations", expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer saved-key", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  });
  it("queries the original encoded task id and preserves audio URLs", async () => {
    const payload = { code: 200, data: { status: "completed", result: { music: [{ audio_url: "https://cdn.test/a.mp3" }] } } };
    m.fetch.mockResolvedValue(new Response(JSON.stringify(payload)));
    expect(await getSunoTask("task/1")).toEqual(payload);
    expect(m.fetch.mock.calls[0][1]).toBe("https://saved.test/v1/music/tasks/task%2F1?language=zh");
  });
  it("sanitizes provider credentials in rejected responses", async () => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify({ message: "saved-key forbidden at https://saved.test" }), { status: 403 }));
    try { await submitSuno({}); throw new Error("expected rejection"); } catch (error: any) { expect(error.rejected).toBe(true); expect(error.message).not.toContain("saved-key"); expect(error.message).not.toContain("https://saved.test"); }
  });
});
