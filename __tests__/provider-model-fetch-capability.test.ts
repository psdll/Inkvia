import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";

describe("provider model-fetch capability", () => {
  it.each([
    ["apimart", "apimart", true],
    ["jiekou", "openai", false],
    ["volcengine", "volcengine", false],
    ["custom-openai", "openai", true],
    ["kie", "openai", false],
    ["google-ai-studio", "gemini", false],
    ["runninghub", "openai", false],
    ["reapi", "openai", false],
    ["aicoming-haiya", "openai", true],
  ] as const)("returns %s model-fetch support as %s", (id, protocol, expected) => {
    expect(supportsProviderModelFetch({ id, protocol })).toBe(expected);
  });

  it("only renders model controls for platforms that support fetching", () => {
    const source = readFileSync(resolve(process.cwd(), "components/admin/ProvidersPanel.tsx"), "utf8");

    expect(source).toContain("const showModelFetch = supportsProviderModelFetch(row);");
    expect(source).toContain("const showChatModels = showModelFetch && llmUiSettings.supportsLlm;");
    expect(source).toContain("{showModelFetch ? <ActionBtn icon={<Download");
  });

  it("rejects model-fetch requests for platforms that do not support the upstream list API", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/admin/providers/fetch-models/route.ts"), "utf8");

    expect(source).toContain("supportsProviderModelFetch(target.provider)");
    expect(source).toContain("该平台不支持拉取模型");
  });
});
