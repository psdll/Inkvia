// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { useCreativeAgent } from "@/components/creative-agent/use-creative-agent";
import { creativeAgentClient as client,CreativeAgentClientError } from "@/lib/creative-agent/client";
vi.mock("@/lib/creative-agent/client",async original=>({...await original<typeof import("@/lib/creative-agent/client")>(),creativeAgentClient:{capabilities:vi.fn(),session:vi.fn(),send:vi.fn(),events:vi.fn(),revise:vi.fn()}}));
vi.mock("@/lib/creative-agent/event-stream-client",()=>({streamCreativeEvents:vi.fn(async()=>undefined)}));
let root:Root,host:HTMLDivElement,agent:ReturnType<typeof useCreativeAgent>;
const selection={nodeIds:[],edgeIds:[],references:[]};
const session=(id="s",skill:string|null="personal:21",messages:any[]=[])=>({sessionId:id,session:{id,activeSkillId:skill,title:"对话",titleSource:"auto" as const,titleMessageId:null,lastMessageId:null,messageCount:messages.length,createdAt:"2026-10-16",updatedAt:"2026-10-16"},messages,run:null,latestSequence:0});
function Probe({id="s"}:{id?:string}){agent=useCreativeAgent({canvasId:17,sessionId:id,onPrepareMessage:async()=>({canvasId:17,revision:"0",selection}),onCanvasCommitted:async()=>{}});return React.createElement("div",null,agent.selectedSkillId??"none");}
async function mount(id="s"){await act(async()=>root.render(React.createElement(Probe,{id})));}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.mocked(client.capabilities).mockResolvedValue({enabled:true,ready:true,reason:null,protocolVersion:1});vi.mocked(client.session).mockImplementation(async(_c,_signal,id)=>session(id));vi.mocked(client.send).mockResolvedValue({sessionId:"s",runId:"r"});vi.mocked(client.events).mockResolvedValue({events:[],nextSequence:0,run:{id:"r",sessionId:"s",canvasId:17,status:"completed",createdAt:"2026-10-16",updatedAt:"2026-10-16"}});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("R23 composer selection is separate from raw draft",()=>{
 // 输入框只显示为下一条消息明确选择的技能；对话已采用的技能由服务端记住，不再回填到输入框
 it("does not put the committed skill back into the composer on refresh/tab switch and submits unchanged raw text without hidden prefix",async()=>{
  await mount();expect(agent.selectedSkillId).toBeNull();await act(async()=>agent.setDraft("😀需要一张海边背景图"));await act(async()=>{await agent.send();});
  expect(client.send).toHaveBeenCalledWith(17,expect.objectContaining({text:"😀需要一张海边背景图"}));expect(vi.mocked(client.send).mock.calls[0][1]).not.toHaveProperty("selectedSkillId");expect(agent.draft).toBe("");expect(agent.selectedSkillId).toBeNull();
  vi.mocked(client.session).mockImplementation(async(_c,_signal,id)=>session(id,id==="new"?null:"personal:21"));await mount("new");expect(agent.selectedSkillId).toBeNull();await mount();expect(agent.selectedSkillId).toBeNull();
 });
 it("persists pending clear across remount and definite rejection, then commits it atomically with next raw message",async()=>{
  await mount();await act(async()=>{agent.setSelectedSkillId(null);agent.setDraft("纯背景");});await act(async()=>root.unmount());root=createRoot(host);await mount();expect(agent.selectedSkillId).toBeNull();expect(agent.draft).toBe("纯背景");
  vi.mocked(client.send).mockRejectedValueOnce(new CreativeAgentClientError("拒绝",400));await act(async()=>{await agent.send();});expect(agent.selectedSkillId).toBeNull();expect(agent.draft).toBe("纯背景");
  await act(async()=>{await agent.send();});expect(client.send).toHaveBeenLastCalledWith(17,expect.objectContaining({selectedSkillId:null,text:"纯背景"}));expect(agent.selectedSkillId).toBeNull();expect(sessionStorage.getItem("creative-agent:skill-intent:v1:17:s")).toBeNull();
 });
 it("recovers accepted-but-response-lost pending skill without a second submission or stale cache overriding server",async()=>{
  await mount();await act(async()=>{agent.setSelectedSkillId("system:3");agent.setDraft("家庭背景图");});vi.mocked(client.send).mockRejectedValueOnce(new Error("network lost"));await act(async()=>{await agent.send();});const sent=vi.mocked(client.send).mock.calls[0][1];expect(agent.uncertain).toBe(true);
  vi.mocked(client.session).mockResolvedValue(session("s","system:3",[{id:sent.messageId,role:"user",text:sent.text,createdAt:"2026-10-16"}]));await act(async()=>root.unmount());root=createRoot(host);await mount();expect(agent.uncertain).toBe(false);expect(agent.draft).toBe("");expect(agent.selectedSkillId).toBeNull();expect(client.send).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem("creative-agent:skill-intent:v1:17:s")).toBeNull();
 });
});


describe("R25 full snapshots synchronize committed skill without accepting pending intent", () => {
 it("loads a reopened conversation from the server even when a newer capability check overtakes the first load", async () => {
  // The browser cached this conversation when it was new (no messages yet).
  localStorage.setItem("creative-agent:snapshot:v1:17:s", JSON.stringify(session("s", null, [])));
  const saved = [{ id: "m1", role: "user", text: "全局看看这个剧本", createdAt: "2026-10-16" }, { id: "m2", role: "assistant", text: "评估结果", createdAt: "2026-10-16" }];
  vi.mocked(client.session).mockImplementation(async (_c, _signal, id) => session(id, null, saved));
  let finishInitial!: (value: Awaited<ReturnType<typeof client.capabilities>>) => void;
  vi.mocked(client.capabilities).mockImplementationOnce(() => new Promise(resolve => { finishInitial = resolve; }));
  await mount();
  expect(agent.view.messages).toHaveLength(0);
  // The saved model preference arrives and re-checks capabilities while the first load waits.
  await act(async () => { await agent.refreshCapabilities({ providerId: "volcengine", modelId: "doubao-seed-evolving" }, new AbortController().signal); });
  await act(async () => finishInitial({ enabled: true, ready: true, reason: null, protocolVersion: 1 }));
  expect(agent.view.messages.map(message => message.text)).toEqual(["全局看看这个剧本", "评估结果"]);
  expect(JSON.parse(localStorage.getItem("creative-agent:snapshot:v1:17:s")!).messages).toHaveLength(2);
  localStorage.clear();
 });
 it("keeps the composer skill empty when refreshCapabilities supersedes the initial capability request", async () => {
  let finishInitial!: (value: Awaited<ReturnType<typeof client.capabilities>>) => void;
  vi.mocked(client.capabilities).mockImplementationOnce(() => new Promise(resolve => { finishInitial = resolve; }));
  await mount();
  await act(async () => { await agent.refreshCapabilities(undefined, new AbortController().signal); });
  expect(agent.selectedSkillId).toBeNull(); expect(agent.draft).toBe("");
  await act(async () => finishInitial({ enabled: true, ready: true, reason: null, protocolVersion: 1 }));
  expect(client.session).toHaveBeenCalledTimes(1);
 });
 it.each([null, "system:3"])("preserves pending %s through refresh hydration and reconnect", async intent => {
  sessionStorage.setItem("creative-agent:skill-intent:v1:17:s", JSON.stringify(intent));
  let finishInitial!: (value: Awaited<ReturnType<typeof client.capabilities>>) => void;
  vi.mocked(client.capabilities).mockImplementationOnce(() => new Promise(resolve => { finishInitial = resolve; }));
  await mount();
  await act(async () => { await agent.refreshCapabilities(undefined, new AbortController().signal); });
  expect(agent.selectedSkillId).toBe(intent);
  await act(async () => finishInitial({ enabled: true, ready: true, reason: null, protocolVersion: 1 }));
  await act(async () => { await agent.reconnect(); });
  expect(client.session).toHaveBeenCalledTimes(2);
  expect(agent.selectedSkillId).toBe(intent);
  expect(sessionStorage.getItem("creative-agent:skill-intent:v1:17:s")).toBe(JSON.stringify(intent));
  await act(async () => agent.setDraft("本轮要求")); await act(async () => { await agent.send(); });
  expect(client.send).toHaveBeenCalledWith(17, expect.objectContaining({ selectedSkillId: intent, text: "本轮要求" }));
 });
 it("does not surface a legacy restored skill in the composer after reconnect", async () => {
  vi.mocked(client.session).mockResolvedValueOnce(session("s", null));
  await mount(); expect(agent.selectedSkillId).toBeNull();
  await act(async () => { await agent.reconnect(); });
  expect(agent.selectedSkillId).toBeNull();
 });
 it.each(["success", "conflict"])("keeps the composer skill empty on revision %s snapshots", async outcome => {
  vi.mocked(client.session).mockResolvedValueOnce(session("s", null));
  await mount();
  if (outcome === "success") vi.mocked(client.revise).mockResolvedValueOnce(session());
  else vi.mocked(client.revise).mockRejectedValueOnce(new CreativeAgentClientError("conflict", 409));
  await act(async () => { await agent.revise({ runId: "r", requestId: "revision", messageId: "m", text: "改正文", expectedText: "原正文" }); });
  expect(agent.selectedSkillId).toBeNull();
 });
 it.each([null, "system:3"])("keeps pending %s when revision accepts a full snapshot", async intent => {
  await mount(); await act(async () => agent.setSelectedSkillId(intent));
  vi.mocked(client.revise).mockResolvedValueOnce(session());
  await act(async () => { await agent.revise({ runId: "r", requestId: "revision", messageId: "m", text: "改正文", expectedText: "原正文" }); });
  expect(agent.selectedSkillId).toBe(intent);
  expect(sessionStorage.getItem("creative-agent:skill-intent:v1:17:s")).toBe(JSON.stringify(intent));
 });
});
