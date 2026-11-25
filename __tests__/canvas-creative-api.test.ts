import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { submitImageGen, submitVideoGen } from "@/components/canvas/run-node";
import { defaultImageAngle, imageAnglePrompt } from "@/lib/canvas/creative-presets/angle";
const mocks = vi.hoisted(() => ({ image: vi.fn(), video: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ getUserId: vi.fn().mockResolvedValue(7) }));
vi.mock("@/lib/canvas/editor-session-server", () => ({ canvasEditorSessionMatches: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/generation/image-service", () => ({ createImageGeneration: mocks.image, ImageGenerationError: class extends Error {} }));
vi.mock("@/lib/generation/video-service", () => ({ createVideoGeneration: mocks.video, VideoGenerationError: class extends Error {} }));
const request = (body: unknown) => new NextRequest("http://localhost/api/canvas/generate", { method: "POST", body: JSON.stringify({ requestKey: "11111111-1111-4111-8111-111111111111", ...(body as object) }), headers: { "Content-Type": "application/json" } });
beforeEach(() => { vi.clearAllMocks(); mocks.image.mockResolvedValue({ generationId: 91, status: "running" }); mocks.video.mockResolvedValue({ generationId: 92, status: "running" }); });
describe("creative preset API boundaries", () => {
  it.each(["image", "video"] as const)("expands inline %s presets in order at the provider boundary", async kind => {
    const { POST } = kind === "image" ? await import("@/app/api/canvas/generate/route") : await import("@/app/api/canvas/generate-video/route");
    const prompt = `前文[[style:style-643]]中段[[filter:filter-714]]${kind === "video" ? "[[motion:motion-645]]" : ""}后文`;
    expect((await POST(request({ prompt, model: kind === "image" ? "gpt-image-2.5-reapi" : "minimax-h3", imagePaths: ["/uploads/ref.png"], mediaPaths: ["/uploads/ref.png"] }))).status).toBe(200);
    const call = (kind === "image" ? mocks.image : mocks.video).mock.calls[0][0];
    expect(call.prompt).toBe("前文中段后文");
  });
  it("sends edited supplements on submission and retry, with the angle instructions composed only once", async () => {
    const { POST } = await import("@/app/api/canvas/generate/route");
    const imageAngle = { ...defaultImageAngle, azimuth: 45, elevation: -30 };
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => POST(request(JSON.parse(String(init?.body)))));
    mocks.image.mockRejectedValueOnce(new Error("upstream failed"));
    const options = { canvasId: 55, sessionId: "session-current", requestKey: "11111111-1111-4111-8111-111111111111", prompt: "保留材质\ndutch angle，tilted frame", model: "gpt-image-2.5-reapi", imagePaths: ["/uploads/ref.png"], imageAngle };
    try {
      await expect(submitImageGen(options)).rejects.toThrow();
      await submitImageGen({ ...options, requestKey: "22222222-2222-4222-8222-222222222222" });
      expect(mocks.image.mock.calls[1][0].prompt).toBe(mocks.image.mock.calls[0][0].prompt);
      await submitImageGen({ ...options, prompt: "柔和光线", requestKey: "33333333-3333-4333-8333-333333333333" });
      for (const [index, call] of mocks.image.mock.calls.entries()) {
        expect(call[0].prompt).toContain(index === 2 ? "柔和光线" : options.prompt);
        expect(call[0].prompt.split(imageAnglePrompt(imageAngle))).toHaveLength(2);
      }
      expect(mocks.image.mock.calls[2][0].prompt).not.toContain(options.prompt);
    } finally { fetch.mockRestore(); }
  });
  it.each([{ azimuth: 38, elevation: -15 }, { azimuth: 322, elevation: 15 }])("sends the same relative camera instructions as the preview: %j", async angles => {
    const { POST } = await import("@/app/api/canvas/generate/route");
    const imageAngle = { ...defaultImageAngle, ...angles, zoom: 5.3 };
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => POST(request(JSON.parse(String(init?.body)))));
    try {
      await submitImageGen({ canvasId: 55, sessionId: "session-current", requestKey: "11111111-1111-4111-8111-111111111111", prompt: "", model: "gpt-image-2.5-reapi", imagePaths: ["/uploads/ref.png"], imageAngle });
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).imageAngle).toEqual(imageAngle);
      expect(mocks.image.mock.calls[0][0].prompt).toContain(imageAnglePrompt(imageAngle));
      expect(mocks.image.mock.calls[0][0].prompt.split(imageAnglePrompt(imageAngle))).toHaveLength(2);
    } finally { fetch.mockRestore(); }
  });
  it.each(["image", "video"] as const)("transports %s selections and composes once before the existing provider service", async kind => {
    const { POST } = kind === "image" ? await import("@/app/api/canvas/generate/route") : await import("@/app/api/canvas/generate-video/route");
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => POST(request(JSON.parse(String(init?.body)))));
    try {
      const creativePresets = {};
      if (kind === "image") await submitImageGen({ canvasId: 55, sessionId: "session-current", requestKey: "11111111-1111-4111-8111-111111111111", prompt: "原文", textList: ["引用"], model: "gpt-image-2.5-reapi", imagePaths: ["/uploads/ref.png"], creativePresets, imageAngle: defaultImageAngle });
      else await submitVideoGen({ canvasId: 55, sessionId: "session-current", requestKey: "11111111-1111-4111-8111-111111111111", prompt: "原文", textList: ["引用"], model: "minimax-h3", mediaPaths: ["/uploads/ref.png"], creativePresets });
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ prompt: "原文", creativePresets });
      const call = (kind === "image" ? mocks.image : mocks.video).mock.calls[0][0];
      expect(call.prompt).toContain("原文引用");
      expect(call[kind === "image" ? "imagePaths" : "mediaPaths"]).toEqual(["/uploads/ref.png"]);
      expect(call.model).toBe(kind === "image" ? "gpt-image-2.5-reapi" : "minimax-h3");
    } finally { fetch.mockRestore(); }
  });
  it("blocks invalid selections and angles without an image before invoking a provider", async () => {
    const { POST } = await import("@/app/api/canvas/generate/route");
    for (const body of [{ prompt: "test", creativePresets: "bad" }, { prompt: "", imageAngle: defaultImageAngle }, { prompt: "", imageAngle: defaultImageAngle, imagePaths: [""] }, { prompt: "test", imageAngle: { ...defaultImageAngle, zoom: -1 } }]) expect((await POST(request(body))).status).toBe(400);
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it("accepts a preset-only prompt and rejects incompatible fixed camera movement", async () => {
    const { POST: image } = await import("@/app/api/canvas/generate/route");
    expect((await image(request({ prompt: "test", creativePresets: { styleId: "style-643" } }))).status).toBe(200);
    expect(mocks.image.mock.calls[0][0].prompt).toBe("test");
    const { POST: video } = await import("@/app/api/canvas/generate-video/route");
    expect((await video(request({ prompt: "test", creativePresets: { motionId: "motion-645" }, cameraFixed: true }))).status).toBe(200);
    expect(mocks.video.mock.calls[0][0].prompt).toBe("test");
  });
  it.each([-90, 90])("forwards pole elevation %s to the current image provider without clipping", async elevation => {
    const { POST } = await import("@/app/api/canvas/generate/route");
    expect((await POST(request({ prompt: "", model: "gpt-image-2.5-reapi", imagePaths: ["/uploads/ref.png"], imageAngle: { ...defaultImageAngle, elevation } }))).status).toBe(200);
    expect(mocks.image.mock.calls[0][0].prompt).toContain(`俯仰 ${elevation}°`);
    expect(mocks.image.mock.calls[0][0].model).toBe("gpt-image-2.5-reapi");
  });
});
