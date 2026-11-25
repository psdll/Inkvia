/** Two explicitly authorized submissions only. Re-running --submit cannot spend again. --poll only queries. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import prisma from "../lib/prisma";
import { VOLC_SEEDREAM_55_MODEL as model } from "../lib/volcengine-seedream-55";
import { createImageGenerationBatch, createImageGenerationInputFromFormData } from "../lib/generation/image-service";
import { finalizeGeneration } from "../lib/generation/finalize";
import { resolvePublicPath } from "../lib/public-path";
const runDir=path.resolve(".exports/volcengine-seedream55-acceptance-20261113");
async function main(){
  assert.equal(process.env.INKVIA_RUNTIME_PROFILE,"local");
  assert.equal(new URL(process.env.DATABASE_URL!).port,"55432");
  await fs.mkdir(runDir,{recursive:true});
  const statePath=path.join(runDir,"submissions.json");
  if(process.argv.includes("--submit")){
    const user=await prisma.generation.findFirst({where:{source:"tool",authUserId:{not:null}},orderBy:{createdAt:"desc"},select:{authUserId:true}});
    assert(user?.authUserId);
    const ref="/uploads/imports/seedream55-acceptance-poster.png";
    await fs.mkdir(path.dirname(resolvePublicPath(ref)),{recursive:true});
    await sharp(Buffer.from('<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" fill="#f3f0e8"/><circle cx="512" cy="430" r="160" fill="#ed7548"/><text x="512" y="780" text-anchor="middle" font-family="Arial" font-size="76" font-weight="bold" fill="#132f42">HELLO SUMMER</text></svg>')).png().toFile(resolvePublicPath(ref));
    // Exclusive marker is written before either request; uncertain attempts are never retried.
    await fs.writeFile(statePath,JSON.stringify({startedAt:new Date(),results:[]}),{flag:"wx"});
    const results:any[]=[];
    for(const kind of ["transparent","layers"]){
      const form=new FormData();
      form.set("model",model);form.set("resolution","1K");form.set("aspectRatio","1:1");form.set("taskCount","1");
      form.set("requestKey",kind === "transparent" ? "5c460c74-c994-4cab-a23e-f21ff3bfa533" : "65d25a6f-0c59-42e2-a30d-5442bfca2f28");
      form.set("prompt",kind==="transparent"?"A single orange ceramic coffee cup, isolated, centered, soft studio lighting, transparent background, no text, no shadow outside the object.":"");
      if(kind==="transparent")form.set("background","transparent");
      else{form.set("imagePaths",JSON.stringify([ref]));form.set("seedream55",JSON.stringify({layerDecomposition:true,layerMaxImages:3,textRecognition:true}));}
      try{const result=await createImageGenerationBatch(createImageGenerationInputFromFormData(user.authUserId,form));results.push({kind,...result});}
      catch(e){results.push({kind,error:e instanceof Error?e.message:"submission failed"});}
      await fs.writeFile(statePath,JSON.stringify({results},null,2));
      console.log(JSON.stringify(results.at(-1)));
    }
  }
  if(process.argv.includes("--submit")) {
    // The official API responds synchronously inside the application's background task.
    // Keep this process alive until it has returned and durable output finalization completes.
    const state=JSON.parse(await fs.readFile(statePath,"utf8"));
    const ids=state.results.flatMap((r:any)=>(r.tasks||[]).map((t:any)=>t.generationId)).filter(Boolean);
    const deadline=Date.now()+15*60*1000;
    while(ids.length && Date.now()<deadline){
      for(const id of ids) await finalizeGeneration(id);
      const active=await prisma.generation.count({where:{id:{in:ids},status:{in:["pending","running"]}}});
      if(!active)break;
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
  }
  if(process.argv.includes("--poll") || process.argv.includes("--submit")){
    const state=JSON.parse(await fs.readFile(statePath,"utf8"));
    for(const result of state.results){
      for(const task of result.tasks||[]){
        if(!task.generationId)continue;
        await finalizeGeneration(task.generationId);
        const row=await prisma.generation.findUnique({where:{id:task.generationId},select:{id:true,status:true,localPath:true,errorMsg:true,templateData:true,externalTaskId:true}});
        const meta=JSON.parse(row?.templateData||"{}");
        const request=meta.volcengine?.request||{};
        console.log(JSON.stringify({kind:result.kind,id:row?.id,status:row?.status,error:row?.errorMsg,request:{model:request.model,size:request.size,background:request.background,layer_decomposition:request.layer_decomposition,layer_decomposition_options:request.layer_decomposition_options},outputs:meta.savedOutputs?.length,providerStatus:meta.providerStatus}));
        if(row?.status==="success"){
          const rows=await prisma.generation.findMany({where:{externalProvider:"volcengine",externalTaskId:row.externalTaskId,status:"success"},select:{id:true,localPath:true,templateData:true}});
          const files=[];
          for(const item of rows){
            if(!item.localPath)continue;
            const m=JSON.parse(item.templateData||"{}");
            const image=sharp(resolvePublicPath(item.localPath));const info=await image.metadata();const stats=await image.stats();
            const ledger=await prisma.usageLedger.findUnique({where:{generationId:item.id},select:{costStatus:true,currency:true,amount:true,unitCount:true}});
            files.push({generationId:item.id,localPath:item.localPath,width:info.width,height:info.height,format:info.format,hasAlpha:info.hasAlpha,alphaMin:info.hasAlpha?stats.channels.at(-1)?.min:undefined,layer:m.seedream55Output?.layer,pixelTier:m.seedream55PixelTier,imageInputCount:m.imageInputCount,ledger});
          }
          await fs.writeFile(path.join(runDir,`${result.kind}-result.json`),JSON.stringify(files,null,2));
          console.log(JSON.stringify({kind:result.kind,files}));
        }
      }
    }
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
