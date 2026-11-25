import { describe, it, expect } from "vitest";
import { resolveConversationSkill, conversationMediaArgs, emptyConversationContext, conversationContextPolicy, assertConversationReferenceVersions, anchorWithReceiptVersions } from "@/lib/creative-agent/conversation-context";
import { sentReferenceSegments } from "@/components/creative-agent/sent-reference-segments";
const references = ["1_80.png", "1_103 拷贝.png", "1_110 拷贝.png"].map((label, i) => ({canvasId: 117,nodeId:`node-${i}`,kind:"image",label,semanticHash:"a".repeat(64)}));
const context = {...emptyConversationContext(),skillId:"personal:21",referenceAnchor:{runId:"old",messageId:"old-message",references}};
const run:any = {id:"current",input:{messageId:"current-message",text:"需要一张海边背景图",conversationContext:context,selection:{nodeIds:[],edgeIds:[],references:[]}}};
describe("conversation creation context",()=>{
 it("inherits, replaces and durably clears explicit skill without rewriting raw text",()=>{
  expect(resolveConversationSkill("需要一张海边背景图",undefined,context)).toBe("personal:21");
  expect(resolveConversationSkill("海边",null,context)).toBeNull();
  expect(resolveConversationSkill("/skill:system:3 海边",undefined,context)).toBe("system:3");
  expect(()=>resolveConversationSkill("/skill:system:3 海边",null,context)).toThrow();
  expect(resolveConversationSkill("海边",undefined,emptyConversationContext())).toBeNull();
 });
 it("keeps only the three exact current source identities across scene requests",()=>{
  const args=conversationMediaArgs(run,{prompt:"三张参考图中的同一产品置于海边"});
  expect(args.references).toHaveLength(3); expect(args.references?.map((r:any)=>r.nodeId)).toEqual(references.map(r=>r.nodeId));
  expect(()=>conversationMediaArgs(run,{prompt:"海边",references:[{nodeId:"other",semanticHash:"b".repeat(64)}]})).toThrow();
 });
 it("requires current raw evidence for subject clear rather than trusting omitted references",()=>{
  expect(()=>conversationMediaArgs(run,{prompt:"海边",subject:{mode:"clear",source:{kind:"message",sourceId:"old-message",quote:"不要产品"}}})).toThrow();
  const next={...run,input:{...run.input,text:"不要产品，只要纯海景"}};
  expect(conversationMediaArgs(next,{prompt:"纯海景",subject:{mode:"clear",source:{kind:"message",sourceId:"current-message",quote:"不要产品，只要纯海景"}}}).references).toEqual([]);
 });
 it("replaces exact longest known mentions, preserves unknown and ambiguous names",()=>{
  const parts=sentReferenceSegments("@1_80.png @1_103 拷贝.png @1_110 拷贝.png 海边 @陌生",references);
  expect(parts.filter(p=>p.reference).map(p=>p.reference?.nodeId)).toEqual(references.map(r=>r.nodeId));
  expect(parts.filter(p=>p.text).map(p=>p.text).join("")).toContain("海边 @陌生");
  const duplicate=[references[0],{...references[0],nodeId:"other-version"}];
  expect(sentReferenceSegments("@1_80.png",duplicate).filter(p=>p.text).map(p=>p.text).join("")).toBe("@1_80.png");
  const script={canvasId:117,nodeId:"text-1",kind:"text",label:"脚本.md",semanticHash:"b".repeat(64)} as any;
  expect(sentReferenceSegments("@脚本.md全局看一下这个剧本",[script])).toEqual([{reference:script},{text:"全局看一下这个剧本"}]);
  expect(sentReferenceSegments("看下@脚本.md",[script])).toEqual([{text:"看下"},{reference:script}]);
  const short={...references[0],label:"图片1",nodeId:"short"};
  expect(sentReferenceSegments("@图片12 和 mail@图片1",[short]).filter(p=>p.text).map(p=>p.text).join("")).toBe("@图片12 和 mail@图片1");
 });
});

it("does not treat a content-version change as a fresh binding or erase versions with an empty newer request",()=>{
 const anchored:any={...context.referenceAnchor,referenceVersions:[{nodeId:"node-0",contentVersion:"original"}]};
 const current:any={...run,input:{...run.input,conversationContext:{...context,referenceAnchor:anchored}}};
 expect(()=>assertConversationReferenceVersions(current,{referenceVersions:[{nodeId:"node-0",contentVersion:"changed"}]} as any)).toThrow();
 expect(anchorWithReceiptVersions(anchored,{referenceVersions:[],request:{references:[]}} as any)).toEqual(anchored);
});
it("keeps the added host policy and tool schema bounded",async()=>{
 const {createCreativeTools}=await import("@/lib/creative-agent/tools");
 const definitions=createCreativeTools({...run,input:{...run.input,matchingPolicyVersion:2,mediaAuthorizationVersion:1}} as any,{} as any,async()=>({})).map(({name,description,parameters})=>({name,description,parameters}));
 const previous=structuredClone(definitions);for(const tool of previous)delete (tool.parameters as any).properties.subject;
 const extraSchemaBytes=Buffer.byteLength(JSON.stringify(definitions))-Buffer.byteLength(JSON.stringify(previous));
 console.info("R23 UTF8 increments",JSON.stringify({hostPolicyBytes:Buffer.byteLength(conversationContextPolicy),toolSchemaBytes:extraSchemaBytes,tools:definitions.length}));
 expect(extraSchemaBytes).toBeLessThan(4000);expect(Buffer.byteLength(conversationContextPolicy)).toBeLessThan(1000);
});
