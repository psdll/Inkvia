import { describe, expect, it } from "vitest";
import { canvasNodeSchema, createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { buildCanvasRunStepSubmission, buildCanvasRunStepSuccessPatch } from "@/lib/canvas/run-worker-contract";
import { preserveCanvasTaskExecutions } from "@/lib/canvas/task-history";
import { replaceCanvasMedia } from "@/lib/canvas/replace-media";
const node: CanvasNode = { id:"music",type:"audioTask",position:{x:0,y:0},data:{kind:"audioTask",model:"suno-v6-apimart",prompt:"旧语音稿",voiceId:"old-voice",speed:1,pitch:0,volume:1,modifyPitch:0,modifyIntensity:0,modifyTimbre:0,soundEffect:"",status:"idle",suno:{description:"描述草稿",custom:true,lyrics:"歌词草稿",style:"piano"}} };
const tracks = [1,2,3].map(i => ({ url:`/uploads/${i}.mp3`, generationId:100+i, suno:{audioIndex:i,taskId:"upstream-task",title:`歌曲${i}`,durationSeconds:20+i} }));
describe("Suno canvas workflow persistence", () => {
  it("submits the active lyrics instead of the old speech prompt", () => {
    const submission = buildCanvasRunStepSubmission({nodeKind:"audioTask",node});
    expect(submission).toMatchObject({kind:"audio",text:"歌词草稿",suno:{description:"描述草稿",lyrics:"歌词草稿",custom:true}});
  });
  it("persists all songs and original identities through document validation", () => {
    const patch = buildCanvasRunStepSuccessPatch({runId:1,stepId:"suno-step",nodeKind:"audioTask",pinnedNodeData:node.data,output:{url:tracks[0].url,generationId:101,outputs:tracks,durationSeconds:21},finishedAt:1000});
    const restored = canvasNodeSchema.parse({...node,data:{...node.data,...patch.data}});
    expect(restored.data).toMatchObject({audioOutputs:tracks.map(o=>({...o.suno,url:o.url,generationId:o.generationId})),selectedAudioIndex:0,outputName:"歌曲1"});
    const doc = {...createEmptyCanvasDocumentV2(),nodes:[restored as CanvasNode]};
    expect(preserveCanvasTaskExecutions({...doc,nodes:[node]},doc).nodes[0].data).toMatchObject({audioOutputs:expect.arrayContaining([{...tracks[2].suno,url:tracks[2].url,generationId:103}])});
  });
  it("keeps invalid partial duration drafts saveable but validates at submission", () => {
    expect(()=>canvasNodeSchema.parse({...node,data:{...node.data,suno:{custom:true,duration:3,lyrics:"草稿"}}})).not.toThrow();
  });
  it("clears old multi-song output when replacing the selected media", () => {
    const doc = {...createEmptyCanvasDocumentV2(),nodes:[{...node,data:{...node.data,status:"success",outputUrl:tracks[0].url,audioOutputs:tracks.map(o=>({...o.suno,url:o.url}))}} as CanvasNode]};
    const replaced = replaceCanvasMedia(doc,"music",{kind:"audio",url:"/uploads/replacement.mp3",mediaId:"276bb035-9d5c-462d-aa98-01ae1bccae00"});
    expect(replaced.nodes[0].data).not.toHaveProperty("audioOutputs");
  });
});
