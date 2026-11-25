import { isProviderModelEnabled } from "../lib/providers/model-availability";
/** Local integration check. --write installs missing model prices without replacing admin rules. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import prisma from "../lib/prisma";
import { VOLC_SEEDREAM_55_MODEL as model, VOLC_SEEDREAM_55_UPSTREAM } from "../lib/volcengine-seedream-55";
import { VOLC_SEEDREAM_55_PRICE_RULES } from "../lib/volcengine-seedream-55-pricing";
import { getRegisteredProviders } from "../lib/providers/registry";
import { getImageEditModelVisibility, getVisibleImageEditModels } from "../lib/image-edit-models";
import { getBillingCatalog } from "../lib/billing/catalog";
import { readBillingSettings, withBillingWrite } from "../lib/billing/settings";
import { BILLING_SETTING_KEY } from "../lib/billing/money";
async function main() {
  assert.equal(process.env.INKVIA_RUNTIME_PROFILE, "local");
  const dbUrl = new URL(process.env.DATABASE_URL!);
  assert.equal(`${dbUrl.hostname}:${dbUrl.port}${dbUrl.pathname}`, "127.0.0.1:55432/ai_stools_mac_dev");
  const providers = await getRegisteredProviders();
  const provider = providers.find(p=>p.id === "volcengine")!;
  const visibility = await getImageEditModelVisibility();
  const product = (await getVisibleImageEditModels()).find(m=>m.id === model);
  assert(provider?.enabled && provider.apiKey && provider.imageModels.includes(VOLC_SEEDREAM_55_UPSTREAM));
  assert(isProviderModelEnabled(providers, "image", model) && visibility[model] !== false && product);
  console.log(JSON.stringify({ model, enabled:provider.enabled, hasKey:Boolean(provider.apiKey), upstream:VOLC_SEEDREAM_55_UPSTREAM, visible:visibility[model], productLabel:product.label }));
  if (process.argv.includes("--write")) await withBillingWrite(async db=>{
    const existing = await db.billingPriceRule.findMany({where:{provider:"volcengine",model}});
    if (existing.length) return;
    const directory = path.resolve(".exports/billing",`volcengine-seedream-55-${Date.now()}`);
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,"before.json"),JSON.stringify(existing,null,2));
    const data=VOLC_SEEDREAM_55_PRICE_RULES.map(rule=>({...rule,displayName:"Seedream-5.5（火山官方）",isActive:true,effectiveFrom:new Date()}));
    await db.billingPriceRule.createMany({data});
    const settings=await db.appSetting.findUnique({where:{key:BILLING_SETTING_KEY}});
    if(settings){const value=JSON.parse(settings.value);value.revision=(value.revision||0)+1;await db.appSetting.update({where:{key:BILLING_SETTING_KEY},data:{value:JSON.stringify(value)}});}
    fs.writeFileSync(path.join(directory,"installed.json"),JSON.stringify(data,null,2));
    console.log(JSON.stringify({installed:data.length,backup:directory}));
  });
  const settings=await readBillingSettings();
  const catalog=await getBillingCatalog(settings,new Date(),prisma,{provider:"volcengine",model});
  console.log(JSON.stringify({mode:settings.mode,complete:catalog[0]?.complete,slots:catalog[0]?.slots.map(s=>({unit:s.unitType,conditions:s.conditions,price:s.rule?.unitPrice,currency:s.rule?.currency}))}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
