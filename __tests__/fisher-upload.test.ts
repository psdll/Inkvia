import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadToFisher } from "@/lib/media-delivery/fisher-upload";

const network = vi.hoisted(() => ({ fetch: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: network.fetch,
  resolveProviderRequestContext: network.context,
}));

describe("FisherAI reference upload", () => {
  const decision = { providerId: "work-fisher", mode: "direct" };
  const provider = { name: "FisherAI", baseUrl: "https://fisher.example/v1/", apiKey: "saved-fisher-key" };
  const image = { blob: new Blob(["image"], { type: "image/png" }), mime: "image/png", name: "reference.png" };

  beforeEach(() => {
    network.fetch.mockReset();
    network.context.mockReset().mockResolvedValue({ provider, decision });
  });

  it("posts a multipart file using the configured provider and returns the signed reference URL", async () => {
    const url = "https://media.fisher.example/ref.png?q-sign-algorithm=sha1";
    network.fetch.mockResolvedValue(Response.json({ url, file_type: "image", size: 5, expires_in: 86400 }));

    await expect(uploadToFisher(image)).resolves.toBe(url);
    expect(network.context).toHaveBeenCalledWith("work-fisher");
    expect(network.fetch).toHaveBeenCalledOnce();
    const [requestDecision, endpoint, request] = network.fetch.mock.calls[0];
    expect(requestDecision).toBe(decision);
    expect(endpoint).toBe("https://fisher.example/v1/files/upload");
    expect(request).toMatchObject({ method: "POST", headers: { Authorization: "Bearer saved-fisher-key" } });
    const file = request.body.get("file");
    expect(file.name).toBe("reference.png");
    expect(file.type).toBe("image/png");
    await expect(file.text()).resolves.toBe("image");
  });

  it("rejects unsupported formats before issuing an upload", async () => {
    await expect(uploadToFisher({ ...image, mime: "image/gif", name: "reference.gif" })).rejects.toThrow("格式");
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it("rejects files larger than 50 MB before issuing an upload", async () => {
    const blob = new Blob([new Uint8Array(50 * 1024 * 1024 + 1)], { type: "image/png" });

    await expect(uploadToFisher({ ...image, blob })).rejects.toThrow("50 MB");
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it("reports the upstream status without exposing credentials from its error body", async () => {
    network.fetch.mockResolvedValue(Response.json({ error: { message: "Rejected saved-fisher-key" } }, { status: 429 }));

    const failure = uploadToFisher(image);
    await expect(failure).rejects.toThrow("HTTP 429");
    await expect(failure).rejects.not.toThrow("saved-fisher-key");
  });

  it("rejects successful responses without an HTTP(S) media URL", async () => {
    network.fetch.mockResolvedValue(Response.json({ url: "data:image/png;base64,aQ==" }));

    await expect(uploadToFisher(image)).rejects.toThrow("没有返回可用的素材链接");
  });
});
