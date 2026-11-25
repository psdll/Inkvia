import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const imageToolSource = readFileSync(resolve(process.cwd(), "app/image/image-tool.tsx"), "utf8");

describe("image model labels", () => {
  it("shows only the product model name without provider, egress mode, or model id metadata", () => {
    const loaderStart = imageToolSource.indexOf('loadImageModelCatalog({ refresh: !initial })');
    const visibleModelLoader = imageToolSource.slice(loaderStart, imageToolSource.indexOf("void loadModels(true)", loaderStart));
    const modelMenu = imageToolSource.slice(
      imageToolSource.indexOf("const parameterFloatingPanel"),
      imageToolSource.indexOf("const footerContent")
    );

    expect(visibleModelLoader).toContain("visibleLabels");
    expect(visibleModelLoader).not.toContain("providerName");
    expect(visibleModelLoader).not.toContain("egressMode");
    expect(visibleModelLoader).not.toContain("egressLabel");
    expect(modelMenu).toContain("{option.label}</span>");
    expect(modelMenu).not.toContain('>{option.value}</span>');
  });
});
