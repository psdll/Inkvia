import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

const YUSHUN_MODEL_ID = ["gpt-image-2-official", "aicoming"].join("-");

describe("removed Yushun AIComing integration", () => {
  it("does not register the Yushun provider or its local model", () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS.some((model) => model.id === YUSHUN_MODEL_ID)).toBe(false);
    expect(getBuiltinProviders().some((provider) => provider.id === "aicoming")).toBe(false);
  });

  it("drops a previously saved Yushun provider without affecting Haiya", () => {
    const providers = mergeSavedProvidersWithBuiltins([
      {
        id: "aicoming",
        name: "雨顺星枢 AI（AIComing）",
        protocol: "openai",
        baseUrl: "https://api.aicoming.top/v1",
        envKeyName: "",
        egressMode: "direct",
        imageModels: ["gpt-image-2-official"],
        videoModels: [],
        chatModels: [],
        modelProtocols: {},
        enabled: true,
        sortOrder: 0,
      },
    ]);

    expect(providers.some((provider) => provider.id === "aicoming")).toBe(false);
    expect(providers.some((provider) => provider.id === "aicoming-haiya")).toBe(true);
  });

  it("removes the Yushun model from active product and request code", () => {
    const files = [
      "lib/aicoming-image.ts",
      "lib/generation/image-service.ts",
      "lib/gpt-image-2-official.ts",
      "lib/toolbox-models.ts",
      "lib/image-edit-models.ts",
      "lib/canvas/image-task.ts",
      "lib/generation/task-input-schema.ts",
      "app/image/image-tool.tsx",
      "components/admin/InspirationTemplatesPanel.tsx",
      "components/admin/BillingPriceRulesPanel.tsx",
    ];

    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toContain(YUSHUN_MODEL_ID);
    }
  });
});
