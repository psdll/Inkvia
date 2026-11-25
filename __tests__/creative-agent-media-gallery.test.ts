// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMediaGallery } from "@/components/creative-agent/AgentMedia";
import type { CreativeAgentMedia } from "@/lib/creative-agent/contracts";

let host: HTMLDivElement, root: Root;
const locate = vi.fn();
const media = (id: number, overrides: Partial<CreativeAgentMedia> = {}): CreativeAgentMedia => ({
  generationId: id, runId: "r", status: "success", mediaType: "image", model: "private-model-id", createdAt: "2026-10-14",
  nodeIds: [`fallback-${id}`], outputs: [{ url: `/uploads/${id}.png`, nodeId: `output-${id}`, width: 1600, height: 900 }],
  review: { status: "completed", message: "旧的生成后检查报告" }, ...overrides,
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); locate.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (items: CreativeAgentMedia[], settled = false) => { await act(async () => root.render(React.createElement(AgentMediaGallery, { media: items, onLocate: locate, settled }))); };
const click = async (selector: string) => { await act(async () => (host.querySelector(selector) as HTMLButtonElement).click()); };

it("collapses outputs across tasks in the same run and toggles a two-image gallery", async () => {
  await render([media(1), media(2)]);
  expect(host.textContent).toContain("图片已生成 ×2"); expect(host.textContent).toContain("+1");
  expect(host.querySelectorAll("img")).toHaveLength(1);
  expect(host.querySelector('[aria-expanded="false"]')).not.toBeNull();
  await click('[aria-label="定位图片 1 到画布"]');
  expect(locate).toHaveBeenCalledWith("output-1");
  expect(host.querySelectorAll("img")).toHaveLength(1);
  await click('[aria-expanded="false"]');
  expect(host.querySelectorAll("img")).toHaveLength(2);
  expect(host.querySelector('[aria-expanded="true"]')).not.toBeNull();
  await click('[aria-label="定位图片 2 到画布"]'); expect(locate).toHaveBeenCalledWith("output-2");
  await click('[aria-expanded="true"]'); expect(host.querySelectorAll("img")).toHaveLength(1);
});
it("shows a single image directly without model, dimensions, reviews or follow-up buttons", async () => {
  await render([media(1)]);
  expect(host.querySelector('img[src="/uploads/1.png"]')).not.toBeNull();
  expect(host.textContent).not.toMatch(/private-model|1600|检查|采用|调整|换场景|#1/);
  expect(host.querySelector('[aria-expanded]')).toBeNull();
  expect(host.querySelector('[download], [aria-label^="下载"]')).toBeNull();
  expect(host.querySelectorAll('button')).toHaveLength(1);
  await click('[aria-label="定位图片 1 到画布"]'); expect(locate).toHaveBeenCalledWith("output-1");
  expect(host.querySelector('img')?.closest('button')?.getAttribute('aria-label')).toBe("定位图片 1 到画布");
  expect(document.querySelector('dialog')).toBeNull();
});
it("does not open a lightbox or invent a location when an output has no canvas node", async () => {
  await render([media(1, { nodeIds: [], outputs: [{ url: "/uploads/orphan.png" }] })]);
  await click('img');
  expect(locate).not.toHaveBeenCalled();
  expect(document.querySelector('dialog')).toBeNull();
});
it("counts actual outputs including batch children and keeps video separate", async () => {
  await render([media(1, { outputs: [media(1).outputs[0], media(2).outputs[0]] }), media(3, { mediaType: "video", outputs: [{ url: "/uploads/3.mp4" }] })]);
  expect(host.textContent).toContain("图片已生成 ×2"); expect(host.textContent).toContain("视频已生成");
  expect(host.querySelector("video")?.getAttribute("controls")).not.toBeNull();
  expect(host.querySelector("video")?.autoplay).toBe(false);
});
it("keeps partial results visible alongside pending and failed tasks without collapsing errors", async () => {
  await render([media(1), media(2, { status: "running", outputs: [] }), media(3, { status: "failed", error: "服务暂不可用", outputs: [] })]);
  expect(host.querySelectorAll("img")).toHaveLength(1);
  expect(host.textContent).toContain("图片生成中"); expect(host.textContent).toContain("服务暂不可用");
  await render([media(1), media(2)]);
  expect(host.querySelector('[aria-expanded="false"]')).not.toBeNull();
});

it("places an accurate closing summary after all media and includes failed task reasons", async () => {
  await render([media(1), media(2, { status: "failed", outputs: [], error: "服务暂不可用" })], true);
  const summary = host.querySelector('[aria-label="本轮生成结果说明"]');
  expect(summary).not.toBeNull();
  expect(summary?.textContent).toContain("1 项成功，1 项失败");
  expect(summary?.textContent).toContain("图片任务 2：服务暂不可用");
  expect(summary?.textContent).toContain("已同步到画布");
  expect(host.lastElementChild).toBe(summary);
});
it("does not conclude while any task or the Agent submission is still pending", async () => {
  await render([media(1)], false);
  expect(host.querySelector('[aria-label="本轮生成结果说明"]')).toBeNull();
  await render([media(1), media(2, { status: "running", outputs: [] })], true);
  expect(host.querySelector('[aria-label="本轮生成结果说明"]')).toBeNull();
});
it("does not claim an unsynchronized result is on the canvas and explains cancellations", async () => {
  await render([media(1, { nodeIds: [], outputs: [{ url: "/1.png" }] }), media(2, { status: "cancelled", outputs: [] })], true);
  const summary = host.querySelector('[aria-label="本轮生成结果说明"]');
  expect(summary?.textContent).not.toContain("已同步到画布");
  expect(summary?.textContent).toContain("画布位置尚未确认");
  expect(summary?.textContent).toContain("1 项取消");
});

it("references the chosen child output, and never offers an unbound result", async () => {
  const reference = vi.fn();
  await act(async () => root.render(React.createElement(AgentMediaGallery, { media: [media(1, { outputs: [
    { url: "/one.png", nodeId: "shared-task", generationId: 11 },
    { url: "/two.png", nodeId: "shared-task", generationId: 12 },
  ] })], onLocate: locate, onReference: reference })));
  await click('[aria-expanded="false"]');
  await click('[aria-label="引用图片 2"]');
  expect(reference).toHaveBeenCalledWith({ nodeId: "shared-task", generationId: 12, mediaType: "image" });
  await act(async () => root.render(React.createElement(AgentMediaGallery, { media: [media(1, { nodeIds: [], outputs: [{ url: "/orphan.png" }] })], onLocate: locate, onReference: reference })));
  expect(host.querySelector('[aria-label="引用图片 1"]')).toBeNull();
});

it("shows why one failed item is being retried while retaining an already successful result", async () => {
  await render([media(1), media(2, { status: "failed", outputs: [], error: "服务暂不可用" }),
    media(3, { status: "running", outputs: [], retryOfGenerationId: 2, retryAttempt: 1, retryReason: "服务暂不可用" })]);
  expect(host.querySelectorAll("img")).toHaveLength(1);
  expect(host.textContent).toContain("服务暂不可用");
  expect(host.textContent).toContain("正在自动重试（1/1）");
  expect(host.textContent).not.toContain("本轮生成任务已结束");
});

it('does not locate ambiguous multi-output results by the completion array index', async () => {
 await render([media(1,{nodeIds:['old-red','new-beige'],outputs:[{url:'/beige.png',generationId:3},{url:'/red.png',generationId:2}]})]);
 expect(host.querySelector('[aria-label="图片缩略图"]')?.hasAttribute('disabled')).toBe(true);
});
it('shows the entire plan, selected model, supported requirements and current step without price or raw metadata', async () => {
 const {MediaPlan}=await import('@/components/creative-agent/AgentMedia');
 await act(async()=>root.render(React.createElement(MediaPlan,{media:{mediaType:'image',model:{id:'private-id',label:'可见模型'},prompt:'海报',params:{aspectRatio:'1:1',resolution:'2K',count:1},units:1,references:[],planSummary:{planId:'internal',stepId:'a',limits:{finalOutputs:3,intermediateOutputs:0,initialCalls:3,retryCalls:0},output:{calls:1,minReturned:0,expectedReturned:1,maxReturned:1,basis:'internal-contract'},selectedWhy:['通过当前硬参数、真实引用与输出数量合同筛选'],wholePlan:{finalOutputs:3,intermediateOutputs:0,initialCalls:3,steps:3,currentStep:1,unreadySteps:0,minReturned:0,maxReturned:3}}}})));
 expect(host.textContent).toContain('可见模型');expect(host.textContent).toContain('最终成果 3');expect(host.textContent).toContain('第 1 / 3 步');expect(host.textContent).toContain('2K');expect(host.textContent).not.toMatch(/internal|价格|报价|requestHash/);
});

it.each([['flare','当前普通模式','普通'],['sunburst','当前高级模式','高级']])('renders effective image variant and safe parameters after JSON refresh: %s',async(mode,label,modeLabel)=>{
 const {MediaPlan}=await import('@/components/creative-agent/AgentMedia');
 const media:any={mediaType:'image',model:{id:'private-route',label},prompt:'prompt',params:{gptImage25Mode:mode,aspectRatio:'1:1',resolution:'2K',quality:'high',background:'transparent',apiKey:'SECRET',routeId:'PRIVATE',price:99},units:1,references:[]};
 await act(async()=>root.render(React.createElement(MediaPlan,{media:JSON.parse(JSON.stringify(media))})));
 expect(host.textContent).toContain(label);expect(host.textContent).toContain('生成模式：'+modeLabel);expect(host.querySelector('details')?.textContent).toContain('背景：transparent');
 expect(host.textContent).not.toMatch(/SECRET|PRIVATE|apiKey|routeId|price/);
});
it('renders all resolved video settings without arbitrary routing metadata',async()=>{
 const {MediaPlan}=await import('@/components/creative-agent/AgentMedia');
 const media:any={mediaType:'video',model:{id:'private-route',label:'视频模型'},prompt:'prompt',params:{cameraFixed:true,watermark:false,omniReferenceTaskType:'edit',outputFormat:'mov',seed:42,inputMode:'first_last_frame',duration:-1,apiKey:'SECRET'},units:1,references:[]};
 await act(async()=>root.render(React.createElement(MediaPlan,{media})));
 for(const value of ['固定镜头：是','水印：否','参考视频用途：编辑','输出格式：MOV','随机种子：42','输入方式：首尾帧','时长（秒）：自动'])expect(host.textContent).toContain(value);
 expect(host.querySelector('details')?.textContent).toContain('随机种子：42');expect(host.textContent).not.toContain('SECRET');
});
it.each([[7,0,'整套方案返回：3–7 份'],[undefined,0,'整套方案返回：至少 3 份，最多返回数未确认'],[undefined,2,'2 个步骤尚未就绪，整套最多返回数未确认']])('distinguishes whole-plan interval and unready steps from step range/caps: %s %s',async(maxReturned,unreadySteps,expected)=>{
 const {MediaPlan}=await import('@/components/creative-agent/AgentMedia');
 const media:any={mediaType:'image',model:{id:'m',label:'模型'},prompt:'p',params:{},units:1,references:[],planSummary:{limits:{finalOutputs:3,intermediateOutputs:1,initialCalls:4,retryCalls:0,totalOutputs:9},output:{minReturned:1,maxReturned:2},selectedWhy:[],wholePlan:{finalOutputs:3,intermediateOutputs:1,initialCalls:4,steps:4,currentStep:1,minReturned:3,maxReturned,unreadySteps}}};
 await act(async()=>root.render(React.createElement(MediaPlan,{media})));expect(host.textContent).toContain(expected);expect(host.textContent).toContain('本步骤返回：1–2 份');expect(host.textContent).toContain('总生成最多 9 份');
});

it('keeps a settled first result distinct from a waiting plan, then uses actual completed run state',async()=>{
 await act(async()=>root.render(React.createElement(AgentMediaGallery,{media:[media(1)],onLocate:locate,settled:true,runStatus:'waiting_decision'})));
 let summary=host.querySelector('[aria-label="本轮生成结果说明"]')!;
 expect(summary.textContent).toContain('已生成 1 张图片');expect(summary.textContent).toContain('仍有后续操作等待你的确认或回答');expect(summary.textContent).not.toContain('已结束');
 await act(async()=>root.render(React.createElement(AgentMediaGallery,{media:[media(1),media(2),media(3)],onLocate:locate,settled:true,runStatus:'completed'})));
 summary=host.querySelector('[aria-label="本轮生成结果说明"]')!;
 expect(summary.textContent).toContain('已生成 3 张图片');expect(summary.textContent).toContain('本轮生成任务已结束');expect(summary.textContent).not.toContain('等待你的确认');
});
