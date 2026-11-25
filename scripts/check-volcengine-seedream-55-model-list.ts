import { resolveProviderRequestContext, fetchWithProviderEgress } from "../lib/providers/transport";
import { resolvedProviderApiKey } from "../lib/providers/resolve";
import { VOLC_SEEDREAM_55_UPSTREAM } from "../lib/volcengine-seedream-55";
import prisma from "../lib/prisma";
async function main(){
 const ctx=await resolveProviderRequestContext("volcengine");
 const response=await fetchWithProviderEgress(ctx.decision, `${ctx.provider.baseUrl.replace(/\/+$/,"")}/api/v3/models`, {headers:{Authorization:`Bearer ${resolvedProviderApiKey(ctx.provider)}`}});
 const data=await response.json();
 console.log(JSON.stringify({status:response.status,errorCode:data?.error?.code,baseHost:new URL(ctx.provider.baseUrl).hostname, exactModelListed:Array.isArray(data?.data)&&data.data.some((x:any)=>x.id===VOLC_SEEDREAM_55_UPSTREAM),seedream55Models:Array.isArray(data?.data)?data.data.filter((x:any)=>String(x.id).includes('seedream-5-5')).map((x:any)=>x.id):[]}));
}
main().catch(()=>{console.error("Official model-list check failed");process.exitCode=1}).finally(()=>prisma.$disconnect());
