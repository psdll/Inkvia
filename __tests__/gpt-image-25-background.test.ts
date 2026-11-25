import { buildAicomingHaiyaGptImage25Request } from "@/lib/aicoming-gpt-image-25";
import { describe, expect, it } from "vitest";
import { buildApimartGptImage25Request } from "@/lib/apimart-gpt-image-25";
import { buildReapiGptImage25Request } from "@/lib/reapi-gpt-image-25";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { supportsGptImage25Background } from "@/lib/gpt-image-25-models";

it.each(["gpt-image-2.5-apimart", "gpt-image-2.5-reapi", "gpt-image-2.5-aicoming-haiya"])("advertises background controls in the %s catalog", (model) => {
  expect(supportsGptImage25Background(model)).toBe(true);
  expect(getImageModelParams(model).backgrounds?.map((option) => option.value)).toEqual(["auto", "transparent", "opaque"]);
  expect(getImageModelParams(model)).not.toHaveProperty("outputFormats");
});
it.each(["gpt-image-2-apimart", "nano-banana-pro"])("does not advertise unsupported controls for %s", (model) => {
  expect(supportsGptImage25Background(model)).toBe(false);
  expect(getImageModelParams(model).backgrounds).toBeUndefined();
});

describe.each([
  ["Haiya", (input: any) => buildAicomingHaiyaGptImage25Request(input).body],
  ["APIMart", (input: any) => buildApimartGptImage25Request(input)],
  ["reAPI", (input: any) => buildReapiGptImage25Request(input).body],
] as const)("%s background contract", (provider, build) => {
  for (const mode of ["flare", "sunburst"]) {
    for (const imageUrls of [undefined, ["https://example.com/chair.png"]]) {
      it.each(["auto", "opaque", "transparent"])(`${mode} ${imageUrls ? "edit" : "generate"} passes %s and PNG`, (background) => {
        expect(build({ prompt: "chair", mode, imageUrls, background, outputFormat: "png" }))
          .toMatchObject({ model: `gpt-image-2.5-${mode}${provider === "reAPI" ? "-official" : ""}`, background, output_format: "png", n: 1 });
      });
    }
  }
  it("uses PNG for transparency when no format is specified", () => {
    expect(build({ prompt: "chair", background: "transparent" })).toMatchObject({ background: "transparent", output_format: "png" });
  });
  it("accepts transparent WebP and opaque JPEG", () => {
    expect(build({ prompt: "chair", background: "transparent", outputFormat: "webp" })).toMatchObject({ background: "transparent", output_format: "webp" });
    expect(build({ prompt: "chair", background: "opaque", outputFormat: "jpeg" })).toMatchObject({ background: "opaque", output_format: "jpeg" });
  });
  it.each([{ background: "transparent", outputFormat: "jpeg" }, { background: "white" }, { outputFormat: "gif" }])("rejects invalid settings before submission: %j", (params) => {
    expect(() => build({ prompt: "chair", ...params })).toThrow();
  });
});
