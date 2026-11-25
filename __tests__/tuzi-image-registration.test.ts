import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getBuiltinProviders } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { readFileSync } from "node:fs";

const LOCAL_MODEL_ID = "gpt-image-2-tuzi";
const UPSTREAM_MODEL_ID = "gpt-image-2";
const PROVIDER_ID = "tuzi";

describe("TuZi GPT-Image-2 registration", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/prisma");
  });

  it("adds one independent local model without changing sibling model mappings", () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: LOCAL_MODEL_ID,
        label: "GPT-Image-2（tz）",
        provider: PROVIDER_ID,
        upstreamModelId: UPSTREAM_MODEL_ID,
      }),
    ]));

    expect(
      IMAGE_EDIT_MODEL_DEFINITIONS
        .filter((model) => model.id !== LOCAL_MODEL_ID)
        .find((model) => model.id === "gpt-image-2"),
    ).toMatchObject({ provider: "kie", label: "GPT-Image-2（ke）" });
    expect(
      IMAGE_EDIT_MODEL_DEFINITIONS
        .filter((model) => model.id !== LOCAL_MODEL_ID)
        .find((model) => model.id === "image 2"),
    ).toBeUndefined();
  });

  it("registers a disabled direct OpenAI provider with no environment key fallback", () => {
    const provider = getBuiltinProviders().find((item) => item.id === PROVIDER_ID);

    expect(provider).toMatchObject({
      id: PROVIDER_ID,
      name: "兔子 API",
      protocol: "openai",
      baseUrl: "https://api.tu-zi.com/v1",
      envKeyName: "",
      egressMode: "direct",
      enabled: false,
      imageModels: [UPSTREAM_MODEL_ID],
    });
    expect(provider && supportsProviderModelFetch(provider)).toBe(true);
  });

  it("requires provider enablement and the upstream model capability", () => {
    const provider = getBuiltinProviders().find((item) => item.id === PROVIDER_ID)!;

    expect(isProviderModelEnabled([provider], "image", LOCAL_MODEL_ID)).toBe(false);
    expect(isProviderModelEnabled([{ ...provider, enabled: true }], "image", LOCAL_MODEL_ID)).toBe(true);
    expect(isProviderModelEnabled([{
      ...provider,
      enabled: true,
      imageModels: [],
    }], "image", LOCAL_MODEL_ID)).toBe(false);
  });

  it("keeps the new model hidden until an administrator enables visibility", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    vi.doMock("@/lib/prisma", () => ({ default: { appSetting: { findUnique } } }));
    const { getImageEditModelVisibility } = await import("@/lib/image-edit-models");

    await expect(getImageEditModelVisibility()).resolves.toMatchObject({
      [LOCAL_MODEL_ID]: false,
    });
  });

  it("shows model visibility alongside the provider's activation status", () => {
    const panel = readFileSync("components/admin/ImageEditModelsPanel.tsx", "utf8");

    expect(panel).toContain("<ProviderSidebar");
    expect(panel).toContain("enabled: option.enabled");
    expect(panel).toContain("visibility[model.id] !== false");
  });
});
