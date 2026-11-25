import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "components/admin/ProviderModelsModal.tsx"),
  "utf8",
);

describe("provider models modal layout", () => {
  it("presents the upstream model picker as a compact single-column dialog", () => {
    expect(source).toContain("从上游拉取的模型清单");
    expect(source).toContain(
      "共 {totalModelCount} 个模型 · 当前显示 {visibleModels.length} 个",
    );
    expect(source).toContain(
      'const [activeFilter, setActiveFilter] = React.useState<ModelFilter>("all")',
    );
    expect(source).toContain("生图");
    expect(source).toContain("应用到模型列表");
    expect(source).toContain("将应用：");
    expect(source).toContain("rounded-full");
    expect(source).toContain("supportsLlm: boolean");
    expect(source).toContain("const adapterBacked = kind === \"chat\" ? supportsLlm : capability.adapterBacked");
    expect(source).not.toContain(
      "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3",
    );
  });
});
