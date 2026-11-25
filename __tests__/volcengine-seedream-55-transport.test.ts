import { expect, it, vi } from "vitest";
const boundary=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock("@/lib/providers/transport",()=>({resolveProviderRequestContext:vi.fn(async()=>({provider:{id:"volcengine",baseUrl:"https://ark.cn-beijing.volces.com",apiKey:"saved-key"},decision:{providerId:"volcengine",egressMode:"direct"}})),fetchWithProviderEgress:boundary.fetch}));
vi.mock("@/lib/config",()=>({getVolcengineArkBaseUrl:()=>"https://unused.example.com"}));
vi.mock("@/lib/providers/resolve",()=>({resolvedProviderApiKey:(p:any)=>p.apiKey}));
import { volcSeedreamGenerate } from "@/lib/volcengine";
import { buildVolcSeedream55Request } from "@/lib/volcengine-seedream-55";
it("posts the exact official payload once, without model fallback or polling",async()=>{
 const body=buildVolcSeedream55Request({prompt:"cat",resolution:"1K"});
 boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({data:[{url:"https://result.example.com/a.png"}],usage:{output_images:1}})));
 expect(await volcSeedreamGenerate(body,{exactModel:true})).toMatchObject({urls:["https://result.example.com/a.png"],modelUsed:"doubao-seedream-5-5-261028"});
 expect(boundary.fetch).toHaveBeenCalledTimes(1);
 expect(boundary.fetch.mock.calls[0][1]).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
 expect(boundary.fetch.mock.calls[0][2]).toMatchObject({method:"POST",headers:{Authorization:"Bearer saved-key","Content-Type":"application/json"},body:JSON.stringify(body)});
 boundary.fetch.mockClear().mockResolvedValueOnce(new Response(JSON.stringify({error:{message:"model access denied"}}),{status:403}));
 await expect(volcSeedreamGenerate(body,{exactModel:true})).rejects.toThrow("model access denied");
 expect(boundary.fetch).toHaveBeenCalledTimes(1);
});
