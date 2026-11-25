import { expect, it } from "vitest";
import { buildVolcSeedream55Request, VOLC_SEEDREAM_55_MODEL, readVolcSeedream55Outputs } from "@/lib/volcengine-seedream-55";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { imageProviderRequestContract } from "@/lib/generation/image-route-identity";

it("uses the official exact model and excludes legacy and APIMart fields", () => {
  const body = buildVolcSeedream55Request({ prompt: "cat", aspectRatio: "16:9", resolution: "1.5K", background: "transparent", imageUrls: ["https://example.com/a.png"] });
  expect(body).toEqual({ model: "doubao-seedream-5-5-261028", prompt: "cat", size: "2048x1152", image: ["https://example.com/a.png"], output_format: "png", response_format: "url", watermark: false, background: "transparent" });
  for (const key of ["n", "resolution", "aspect_ratio", "image_urls", "quality", "stream", "tools", "sequential_image_generation"]) expect(body).not.toHaveProperty(key);
});
it("uses layer options with no background or forced ratio", () => {
  expect(buildVolcSeedream55Request({ prompt: "", layerDecomposition: true, layerMaxImages: 3, textRecognition: true, imageUrls: ["https://example.com/a.png"], resolution: "1K", aspectRatio: "custom", customSize: "2048x1152", background: "transparent" })).toEqual({ model: "doubao-seedream-5-5-261028", size: "1K", image: ["https://example.com/a.png"], output_format: "png", response_format: "url", watermark: false, layer_decomposition: true, layer_decomposition_options: { max_images: 3, text_recognition: true } });
});
it.each([{resolution:"4K"}, {customSize:"512x512",aspectRatio:"custom"}, {imageUrls:Array(11).fill("https://example.com/a.png")}, {layerDecomposition:true,imageUrls:[]}, {layerDecomposition:true,imageUrls:["a"],layerMaxImages:101}])("rejects invalid contract input %j", options=>{
  expect(()=>buildVolcSeedream55Request({prompt:"cat",...options})).toThrow();
});
it("preserves duplicate layer URLs, metadata and response ordering",()=>{
  expect(readVolcSeedream55Outputs({data:[{url:"https://example.com/a.png",size:"1024x1024",z_index:0},{url:"https://example.com/a.png",z_index:1,text_recognition:{text:"HELLO"}}]})).toEqual([{url:"https://example.com/a.png",size:"1024x1024",layer:{z_index:0}},{url:"https://example.com/a.png",layer:{z_index:1,text_recognition:{text:"HELLO"}}}]);
});
it("exposes official parameters and exact routing",()=>{
  expect(getImageModelParams(VOLC_SEEDREAM_55_MODEL).resolutions.map(x=>x.value)).toEqual(["1K","1.5K","2K"]);
  expect(getImageModelParams(VOLC_SEEDREAM_55_MODEL).backgrounds?.map(x=>x.value)).toContain("transparent");
  expect(imageProviderRequestContract({model:VOLC_SEEDREAM_55_MODEL,seedream55:{layerDecomposition:true,layerMaxImages:3}})).toMatchObject({providerModel:"doubao-seedream-5-5-261028",maxOutputCount:3});
});
it("accepts prompt-free OCR tasks and backfills existing official accounts",async()=>{
  const {createImageTaskSchema}=await import("@/lib/generation/task-input-schema");
  expect(createImageTaskSchema.safeParse({model:VOLC_SEEDREAM_55_MODEL,prompt:"",imagePaths:["/uploads/a.png"],resolution:"1.5K",seedream55:{layerDecomposition:true,textRecognition:true}}).success).toBe(true);
  const {mergeSavedProvidersWithBuiltins}=await import("@/lib/providers/registry");
  const p=mergeSavedProvidersWithBuiltins([{id:"volcengine",name:"Volc",protocol:"volcengine",baseUrl:"https://ark.cn-beijing.volces.com",apiKey:"test",imageModels:["old"],videoModels:[],chatModels:[],modelProtocols:{},enabled:true,egressMode:"direct",sortOrder:0}]).find(p=>p.id==="volcengine")!;
  expect(p.imageModels).toContain("doubao-seedream-5-5-261028");
  expect(p.imageModels).toContain("old");
  expect(p.apiKey).toBe("test");
});

it("maps every offered ratio and resolution to legal official pixel sizes",()=>{
 for(const resolution of ["1K","1.5K","2K"]) for(const aspectRatio of ["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9","2:1","1:2"]){
  const body=buildVolcSeedream55Request({prompt:"cat",aspectRatio,resolution});
  const [w,h]=body.size!.split("x").map(Number);
  const [rw,rh]=aspectRatio.split(":").map(Number);
  expect(w*h).toBeGreaterThanOrEqual(921600);expect(w*h).toBeLessThanOrEqual(4624220);
  expect(w/h).toBeCloseTo(rw/rh,1);
 }
});
