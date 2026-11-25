import { describe, expect, it } from "vitest";
import { expandGptImage25ModelOptions, getGptImage25SelectionValue, resolveGptImage25Selection } from "@/lib/gpt-image-25-models";
import { buildApimartGptImage25Request } from "@/lib/apimart-gpt-image-25";
import { buildReapiGptImage25Request } from "@/lib/reapi-gpt-image-25";
import { buildAicomingHaiyaGptImage25Request } from "@/lib/aicoming-gpt-image-25";
import { normalizeGptImage2OfficialBatchSettings } from "@/components/batch-workbench/batch-settings-panel";

describe("GPT Image 2.5 independent model choices", () => {
  const providers = [
    ["gpt-image-2.5-apimart", "（am）", (mode: string) => buildApimartGptImage25Request({ prompt: "photo", mode }).model],
    ["gpt-image-2.5-reapi", "（re）", (mode: string) => buildReapiGptImage25Request({ prompt: "photo", mode }).body.model],
    ["gpt-image-2.5-aicoming-haiya", "（hai）", (mode: string) => buildAicomingHaiyaGptImage25Request({ prompt: "photo", mode }).body.model],
  ] as const;

  it.each(providers)("splits %s and submits each choice to its original upstream", (model, suffix, build) => {
    const options = expandGptImage25ModelOptions([{ value: model, label: `GPT-Image-2.5${suffix}` }]);
    expect(options.map((option) => option.label)).toEqual([`GPT-Image-2.5 Fast${suffix}`, `GPT-Image-2.5 Pro${suffix}`]);
    for (const [index, mode] of ["flare", "sunburst"].entries()) {
      const selection = resolveGptImage25Selection(options[index].value);
      expect(selection).toEqual({ model, gptImage25Mode: mode });
      expect(build(selection.gptImage25Mode!)).toBe(`gpt-image-2.5-${mode}${model === "gpt-image-2.5-reapi" ? "-official" : ""}`);
      expect(normalizeGptImage2OfficialBatchSettings(options[index].value, "4K", "9:16"))
        .toMatchObject({ model, gptImage25Mode: mode, resolution: "4K", aspectRatio: "9:16" });
      expect(getGptImage25SelectionValue(model, mode)).toBe(options[index].value);
    }
  });

  it("keeps other models and option metadata unchanged", () => {
    const other = { value: "nano-banana-pro", label: "Nano Banana Pro", disabled: true };
    const options = expandGptImage25ModelOptions([other, { value: "gpt-image-2.5-reapi", label: "GPT-Image-2.5", disabled: true }]);
    expect(options[0]).toBe(other);
    expect(options.slice(1).map((option) => option.label)).toEqual(["GPT-Image-2.5 Fast", "GPT-Image-2.5 Pro"]);
    expect(options.every((option) => option.disabled)).toBe(true);
    expect(resolveGptImage25Selection(other.value)).toEqual({ model: other.value });
    expect(getGptImage25SelectionValue(other.value, "sunburst")).toBe(other.value);
  });

  it("restores old drafts with no mode as Fast and retains existing Pro drafts", () => {
    expect(getGptImage25SelectionValue("gpt-image-2.5-reapi")).toBe("gpt-image-2.5-reapi:fast");
    expect(getGptImage25SelectionValue("gpt-image-2.5-reapi", "sunburst")).toBe("gpt-image-2.5-reapi:pro");
    expect(resolveGptImage25Selection("gpt-image-2.5-reapi")).toEqual({ model: "gpt-image-2.5-reapi" });
  });
});
