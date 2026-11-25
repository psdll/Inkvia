import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { withBillingWrite } from '../lib/billing/settings';
async function main(){
 assert.equal(process.env.INKVIA_RUNTIME_PROFILE,'local');
 const u=new URL(process.env.DATABASE_URL!);assert.equal(`${u.hostname}:${u.port}${u.pathname}`,'127.0.0.1:5434/inkvia');
 const changes=JSON.parse(fs.readFileSync('.runtime-local/billing-correction-preview.json','utf8'));
 const keys=['unitType','unitCount','unitPrice','amount','currency','costStatus','pricingSnapshot','usageSnapshot'];
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({proposed:changes.length}));return;}
 const output=path.resolve('.runtime-local/billing-corrections',`${Date.now()}.json`);fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({reason:'stale-worker-unit-mismatch',changes},null,2),{flag:'wx'});
 await withBillingWrite(async db=>{
 for(const c of changes){
  const data:any=Object.fromEntries(keys.map(k=>[k,c.after[k]]).filter(([,v])=>v!==undefined));
  data.pricingSnapshot={...(data.pricingSnapshot||{}),correction:{reason:'stale-worker-unit-mismatch',previousAmount:String(c.before.amount),previousUnitType:c.before.unitType,at:new Date().toISOString()}};
  if(data.usageSnapshot===null)data.usageSnapshot=Prisma.JsonNull;
  const r=await db.usageLedger.updateMany({where:{id:c.id,updatedAt:new Date(c.updatedAt),costStatus:c.before.costStatus},data});
  assert.equal(r.count,1,`Ledger ${c.id} changed; rollback`);
 }
 });
 console.log(JSON.stringify({corrected:changes.length,backup:output}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
