import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins, saveProviders } from "@/lib/providers/registry";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

const REMOVED_PROVIDER_ID = ["f", "al"].join("");
const REMOVED_MODEL_IDS = [
  ["nano", "banana", "pro", "official"].join("-"),
  ["gpt", "image", "2", "official"].join("-"),
];

describe("removed fal.ai integration", () => {
  it("does not register the provider or either local model", () => {
    const modelIds = IMAGE_EDIT_MODEL_DEFINITIONS.map((model) => model.id);

    expect(getBuiltinProviders().some((provider) => provider.id === REMOVED_PROVIDER_ID)).toBe(false);
    for (const modelId of REMOVED_MODEL_IDS) expect(modelIds).not.toContain(modelId);

    expect(modelIds).toContain("nano-banana-pro");
    expect(modelIds).toContain("gpt-image-2");
    expect(modelIds).toContain("gpt-image-2-apimart");
    expect(modelIds).not.toContain("gpt-image-2-jiekou");
    expect(modelIds).not.toContain("gpt-image-2-official-reapi");
    expect(modelIds).toContain("gpt-image-2-aicoming-haiya");
  });

  it("drops a previously saved provider without affecting the remaining providers", () => {
    const providers = mergeSavedProvidersWithBuiltins([
      {
        id: REMOVED_PROVIDER_ID,
        name: "removed provider",
        protocol: "openai",
        baseUrl: "https://removed.invalid",
        envKeyName: "",
        egressMode: "direct",
        imageModels: [...REMOVED_MODEL_IDS],
        videoModels: [],
        chatModels: [],
        modelProtocols: {},
        enabled: true,
        sortOrder: 0,
      },
    ]);

    expect(providers.some((provider) => provider.id === REMOVED_PROVIDER_ID)).toBe(false);
    for (const providerId of ["kie", "apimart", "jiekou", "reapi", "aicoming-haiya"]) {
      expect(providers.some((provider) => provider.id === providerId), providerId).toBe(true);
    }
  });

  it("does not persist a retired provider on the next normal save", async () => {
    let stored = "";
    const client = {
      appSetting: {
        upsert: async ({ create }: { create: { value: string } }) => {
          stored = create.value;
        },
      },
    };

    await saveProviders([
      {
        id: REMOVED_PROVIDER_ID,
        name: "removed provider",
        protocol: "openai",
        baseUrl: "https://removed.invalid",
        envKeyName: "",
        egressMode: "direct",
        imageModels: [...REMOVED_MODEL_IDS],
        videoModels: [],
        chatModels: [],
        modelProtocols: {},
        enabled: true,
        sortOrder: 0,
      },
      getBuiltinProviders().find((provider) => provider.id === "kie")!,
    ], client as never);

    expect(JSON.parse(stored).map((provider: { id: string }) => provider.id)).toEqual(["kie"]);
  });

  it("removes the adapter and active product/request references", () => {
    expect(existsSync(`lib/${REMOVED_PROVIDER_ID}-image.ts`)).toBe(false);

    const files = [
      "lib/config.ts",
      "lib/providers/model-fetch.ts",
      "lib/generation/image-service.ts",
      "lib/generation/finalize.ts",
      "lib/toolbox-models.ts",
      "lib/canvas/image-task.ts",
      "lib/generation/task-input-schema.ts",
      "lib/video-template-reuse.ts",
      "app/image/image-tool.tsx",
      "app/admin/page.tsx",
      "app/works/page.tsx",
      "components/admin/InspirationTemplatesPanel.tsx",
      "components/admin/BillingPriceRulesPanel.tsx",
      "app/api/admin/billing/prices/route.ts",
    ];
    const forbiddenProviderSignals = [
      `@/lib/${REMOVED_PROVIDER_ID}-image`,
      `${REMOVED_PROVIDER_ID}.ai`,
      `${REMOVED_PROVIDER_ID}.run`,
      `provider: "${REMOVED_PROVIDER_ID}"`,
      `provider === "${REMOVED_PROVIDER_ID}"`,
      `externalProvider: "${REMOVED_PROVIDER_ID}"`,
      `params.${REMOVED_PROVIDER_ID}`,
      `p.${REMOVED_PROVIDER_ID}`,
      `${REMOVED_PROVIDER_ID}_`,
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const signal of forbiddenProviderSignals) {
        expect(source, `${file}: ${signal}`).not.toContain(signal);
      }
    }

    const activeModelFiles = [
      "lib/toolbox-models.ts",
      "lib/generation/image-service.ts",
      "lib/generation/finalize.ts",
      "lib/canvas/image-task.ts",
      "lib/generation/task-input-schema.ts",
      "app/image/image-tool.tsx",
      "components/admin/InspirationTemplatesPanel.tsx",
    ];
    for (const file of activeModelFiles) {
      const source = readFileSync(file, "utf8");
      for (const modelId of REMOVED_MODEL_IDS) {
        expect(source, `${file}: ${modelId}`).not.toContain(`"${modelId}"`);
      }
    }
  });
});
