import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Api } from "@earendil-works/pi-ai";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runCreativeAgent } from "@/lib/creative-agent/runner";
import { readRoleSkillDocument, assertRoleSkillRevision } from "@/lib/role-skills/repository";
import { creativeAgentChatMessages } from "@/lib/creative-agent/llm-stream";
import { windowCreativeMessages } from "@/lib/creative-agent/context-window";
import { emptyConversationContext, conversationContextPolicy } from "@/lib/creative-agent/conversation-context";
import { expandCreativeSkillCommand } from "@/lib/creative-agent/skill-packages";
vi.mock("@/lib/creative-agent/reference-preparation",()=>({prepareCreativeAgentReferences:vi.fn()}));
vi.mock("@/lib/prisma",()=>({default:{}}));
vi.mock("@/lib/maintenance",()=>({assertDurableWorkAdmission:vi.fn(),MaintenanceSubmissionError:class extends Error{}}));
vi.mock("@/lib/creative-agent/attachments",()=>({readCreativeAgentAttachments:vi.fn(async()=>[])}));
vi.mock("@/lib/role-skills/repository",()=>({readRoleSkillDocument:vi.fn(),assertRoleSkillRevision:vi.fn(),RoleSkillRepositoryError:class extends Error{},listRoleSkillsForUser:vi.fn()}));
const model:Model<Api>={id:"offline",name:"offline",provider:"local",api:"openai-completions",baseUrl:"http://not-used.invalid",reasoning:false,input:["text"],contextWindow:32000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
const body="完整方法：保留产品外观，按本轮要求调整场景。\n".repeat(1000);
const base:any={id:"current",sessionId:"session",actorUserId:7,canvasId:117,epoch:1,status:"running",createdAt:new Date(2000).toISOString(),input:{actorUserId:7,canvasId:117,messageId:"current-message",text:"需要一张海边背景图",matchingPolicyVersion:2,mediaAuthorizationVersion:1,baseRevision:"0",selection:{nodeIds:[],edgeIds:[],references:[]},conversationContext:{...emptyConversationContext(),skillId:"personal:21"}}};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(readRoleSkillDocument).mockResolvedValue({id:"personal:21",name:"当前技能",revision:8,source:"personal",primaryPath:"SKILL.md",path:"SKILL.md",files:["SKILL.md"],content:body} as any);});
async function capture(run=base,history:any[]=[]){const contexts:any[]=[];const events:any[]=[];let saved=history;const store:any={getRun:vi.fn(async()=>run),assertFence:vi.fn(async()=>run),getTranscript:vi.fn(async()=>saved),saveTranscript:vi.fn(async(_id,_epoch,m)=>{saved=m;}),getRecoveryContext:vi.fn(async()=>""),getReferenceHistory:vi.fn(async()=>conversationContextPolicy+JSON.stringify({referenceAnchor:{references:[{nodeId:"original-product",semanticHash:"a".repeat(64)}]},latestRequest:{request:{prompt:"高端家庭，暖色光，产品不变",params:{resolution:"2K"}}}})),saveAssistant:vi.fn(),appendEvent:vi.fn(async(_id,_epoch,type,payload)=>{events.push({type,payload});}),actionReceipts:vi.fn(async()=>[]),finish:vi.fn(),control:vi.fn()};
 await runCreativeAgent(run,{store,model,tools:[],advancePlan:async()=>"complete",stream:(_model,context)=>{contexts.push(context);const stream=createAssistantMessageEventStream();const msg:AssistantMessage={role:"assistant",content:[{type:"text",text:"完成"}],api:model.api,model:model.id,provider:model.provider,stopReason:"stop",timestamp:3000,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};queueMicrotask(()=>{stream.push({type:"start",partial:msg});stream.push({type:"done",reason:"stop",message:msg});});return stream;}});return {contexts,events,saved,store};}
describe("R23 current skill remains in actual model view",()=>{
 it("rereads current revision on each new turn, keeps raw facts text and avoids another model call after window clipping",async()=>{
  const history=[{role:"user",content:"旧场景"+"x".repeat(200000),timestamp:1},{role:"assistant",content:[{type:"text",text:"旧结果"}],stopReason:"stop",timestamp:2}];
  const {contexts,events}=await capture(base,history);expect(contexts).toHaveLength(1);expect(readRoleSkillDocument).toHaveBeenCalledWith({authUserId:7,publicId:"personal:21",path:undefined,revision:undefined});
  const sent=windowCreativeMessages(creativeAgentChatMessages(contexts[0]),undefined,true);expect(JSON.stringify(sent)).not.toContain("旧场景");expect(JSON.stringify(sent)).toContain(JSON.stringify(body.trim()).slice(1,-1));expect(JSON.stringify(sent)).toContain('revision\\":8');expect(JSON.stringify(sent)).toContain("original-product");expect(JSON.stringify(sent)).toContain("高端家庭");expect(sent.at(-1)?.role).toBe("user");expect(JSON.stringify(sent)).not.toContain("先读取 project_read");
  expect(base.input.text).toBe("需要一张海边背景图");expect(events.some(event=>event.type==="tool.completed"&&event.payload.name==="skillOperator"&&event.payload.status==="success")).toBe(true);
 });
 it("revalidates a resumed run's frozen revision instead of loading later session selection",async()=>{
  const expanded=await expandCreativeSkillCommand(base.input.text,7,undefined,2,1,"personal:21");vi.mocked(readRoleSkillDocument).mockClear();
  const {contexts}=await capture(base,[{role:"user",content:expanded,timestamp:2000}]);expect(contexts).toHaveLength(1);expect(readRoleSkillDocument).not.toHaveBeenCalled();expect(assertRoleSkillRevision).toHaveBeenCalledWith({authUserId:7,publicId:"personal:21",revision:8});
  vi.mocked(assertRoleSkillRevision).mockRejectedValueOnce(new Error("revoked"));await expect(capture(base,[{role:"user",content:expanded,timestamp:2000}])).rejects.toThrow("本轮选择的技能已更新或不可用");
 });
 it("fails closed for deleted/cross-account selection and honors explicit clear over historical skill body",async()=>{
  vi.mocked(readRoleSkillDocument).mockRejectedValueOnce(new Error("deleted"));await expect(capture()).rejects.toMatchObject({code:"SKILL_NOT_FOUND"});
  const cleared={...base,input:{...base.input,conversationContext:emptyConversationContext()}};const {contexts}=await capture(cleared,[{role:"user",content:"用户为本轮选择了以下技能。旧正文",timestamp:1}]);expect(contexts[0].systemPrompt).not.toContain("本轮所选技能的系统执行边界");expect(contexts[0].messages.at(-1).content).toBe(base.input.text);
 });
});
