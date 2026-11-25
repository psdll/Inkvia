import { expect, it } from "vitest";
import { buildApimartSeedream55Request, APIMART_SEEDREAM_55_MODEL } from "@/lib/apimart-seedream-55";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { imageProviderRequestContract } from "@/lib/generation/image-route-identity";

it("uses the exact Seedream 5.5 text generation contract without GPT or group fields", () => {
  expect(buildApimartSeedream55Request({ prompt: "a cat" })).toEqual({ model: "seedream-5-5", prompt: "a cat", size: "2K", n: 1, output_format: "png", background: "auto" });
});
it("supports ordered references, transparent PNG and 1.5K ratio requests", () => {
  expect(buildApimartSeedream55Request({ prompt: "combine", aspectRatio: "16:9", resolution: "1.5K", background: "transparent", imageUrls: ["https://example.com/a.png", "https://example.com/b.png"] })).toEqual({ model: "seedream-5-5", prompt: "combine", size: "16:9", resolution: "1.5K", background: "transparent", output_format: "png", n: 1, image_urls: ["https://example.com/a.png", "https://example.com/b.png"] });
});
it("supports exact pixels without sending resolution", () => {
  const r = buildApimartSeedream55Request({ prompt: "cat", aspectRatio: "custom", customSize: "2048x1152" });
  expect(r.size).toBe("2048x1152"); expect(r).not.toHaveProperty("resolution");
});
it.each([{ resolution: "4K" }, { aspectRatio: "5:4" }, { aspectRatio: "custom", customSize: "512x512" }, { outputFormat: "gif" }, { background: "transparent", outputFormat: "jpeg" }, { imageUrls: Array(11).fill("https://example.com/a.png") }])("rejects unsupported options %j", options => {
  expect(() => buildApimartSeedream55Request({ prompt: "cat", ...options })).toThrow();
});
it("accepts the documented reference boundary and exact pixel boundaries", () => {
  expect(buildApimartSeedream55Request({ prompt: "cat", imageUrls: Array(10).fill("https://example.com/a.png") }).image_urls).toHaveLength(10);
  expect(buildApimartSeedream55Request({ prompt: "cat", aspectRatio: "960x960" }).size).toBe("960x960");
  expect(() => buildApimartSeedream55Request({ prompt: "cat", aspectRatio: "2200x2200" })).toThrow();
});
it("exposes only supported parameters and routes to the exact provider model", () => {
  const params = getImageModelParams(APIMART_SEEDREAM_55_MODEL);
  expect(params.resolutions.map(x=>x.value)).toEqual(["1K", "1.5K", "2K"]);
  expect(params.qualities).toEqual([]);
  expect(params.backgrounds?.map(x=>x.value)).toContain("transparent");
  expect(imageProviderRequestContract({model: APIMART_SEEDREAM_55_MODEL})).toMatchObject({providerModel: "seedream-5-5", declaredOutputCount: 1});
});

it("decomposes exactly one reference, omits background and prompt for OCR", () => {
  expect(buildApimartSeedream55Request({ prompt: "", layerDecomposition: true, textRecognition: true, layerMaxImages: 4, imageUrls: ["https://example.com/poster.png"], background: "transparent", aspectRatio: "16:9", resolution: "1K" })).toEqual({ model: "seedream-5-5", size: "1K", n: 1, output_format: "png", image_urls: ["https://example.com/poster.png"], layer_decomposition: true, layer_decomposition_options: { max_images: 4, text_recognition: true } });
});
it.each([0, 2])("rejects %i references for decomposition", count => {
  expect(() => buildApimartSeedream55Request({prompt:"",layerDecomposition:true,imageUrls:Array(count).fill("https://example.com/a.png")})).toThrow();
});
it.each([1, 101, 2.5])("rejects invalid layer bound %i", layerMaxImages => {
  expect(() => buildApimartSeedream55Request({prompt:"",layerDecomposition:true,layerMaxImages,imageUrls:["https://example.com/a.png"]})).toThrow();
});
it("allows OCR metadata to be absent or mismatched without losing images", async () => {
  const { readSeedream55Outputs, seedream55PixelTier } = await import("@/lib/apimart-seedream-55");
  expect(readSeedream55Outputs({result:{images:[{url:["https://example.com/base.png","https://example.com/layer.png"],layers:[{z_index:0}]}]}})).toEqual([{url:"https://example.com/base.png"},{url:"https://example.com/layer.png"}]);
  expect(seedream55PixelTier("2610x1000")).toBe("low");
  expect(seedream55PixelTier("2611x1000")).toBe("high");
});
it("task input allows an empty prompt only in layer mode and retains OCR settings", async () => {
  const { createImageTaskSchema } = await import("@/lib/generation/task-input-schema");
  const parsed=createImageTaskSchema.parse({model:APIMART_SEEDREAM_55_MODEL,prompt:"",resolution:"1.5K",imagePaths:["/uploads/ref.png"],seedream55:{layerDecomposition:true,textRecognition:true,layerMaxImages:2}});
  expect(parsed.seedream55).toMatchObject({textRecognition:true,layerMaxImages:2});
  expect(createImageTaskSchema.safeParse({model:APIMART_SEEDREAM_55_MODEL,prompt:"",imagePaths:[]}).success).toBe(false);
});

it("backfills the adapter capability without overwriting APIMart account settings", async()=>{
  const { mergeSavedProvidersWithBuiltins }=await import("@/lib/providers/registry");
  const { isProviderModelEnabled }=await import("@/lib/providers/model-availability");
  const providers=mergeSavedProvidersWithBuiltins([{id:"apimart",name:"APIMART",protocol:"apimart",baseUrl:"https://api.apimart.ai/v1",egressMode:"proxy",apiKey:"test-key",imageModels:["gpt-image-2-official"],videoModels:[],chatModels:[],modelProtocols:{},enabled:true,sortOrder:0}]);
  const p=providers.find(p=>p.id==="apimart")!;
  expect(p.imageModels).toContain("seedream-5-5");
  expect(p.egressMode).toBe("proxy");
  expect(isProviderModelEnabled(providers,"image",APIMART_SEEDREAM_55_MODEL)).toBe(true);
});
it("restores layer/OCR preferences and supports batch custom pixels", async()=>{
  const { getGptImage2OfficialBatchOptions }=await import("@/components/batch-workbench/batch-settings-panel");
  const options=getGptImage2OfficialBatchOptions(APIMART_SEEDREAM_55_MODEL,"1.5K","custom");
  expect(options.ratioOptions.map(o=>o.value)).toContain("custom");
  expect(options.resolutionOptions.map(o=>o.value)).toEqual(["1K","1.5K","2K"]);
  expect(imageProviderRequestContract({model:APIMART_SEEDREAM_55_MODEL,seedream55:{layerDecomposition:true,layerMaxImages:3}})).toMatchObject({maxOutputCount:3,outputBasis:"layer_decomposition_max_images"});
});
