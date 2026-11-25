import { expect, it } from "vitest";
import { buildTurnCopyText, getTurnFinishedAt } from "@/components/creative-agent/turn-result";
import { summarizeMediaOutcomes } from "@/lib/creative-agent/media-summary";
import { restoreAgentSnapshot, emptyAgentState } from "@/components/creative-agent/state";
import type { CreativeAgentMessage } from "@/lib/creative-agent/contracts";

const message = (id: string, text: string, createdAt = "2026-10-14T11:57:00Z"): CreativeAgentMessage => ({ id, text, role: "assistant", runId: "r", createdAt });
it("copies all visible replies and generated outputs from only the requested turn", () => {
  const view = { ...emptyAgentState(), messages: [
    { ...message("question", "用户提问"), role: "user" as const },
    { ...message("earlier", "前一轮回复"), runId: "old" },
    { ...message("start", "第一段方案"), thinking: { content: "内部思考" } },
    message("end", "最终结果"), message("r:media:completed", "系统交付重复消息"),
  ], media: [{ generationId: 1, runId: "r", status: "success", mediaType: "image" as const, model: "private-model", nodeIds: ["n1", "n2"], createdAt: "2026-10-14T11:58:00Z", outputs: [{ url: "/uploads/one.png", nodeId: "n1" }, { url: "/uploads/two.png", nodeId: "n2" }] }] };
  const text = buildTurnCopyText(view, "r", "http://localhost:3100");
  expect(text).toContain("第一段方案\n\n最终结果");
  expect(text).toContain("![图片 1](http://localhost:3100/uploads/one.png)");
  expect(text).toContain("![图片 2](http://localhost:3100/uploads/two.png)");
  expect(text).toContain("已生成 2 张图片，结果已同步到画布。");
  expect(text).not.toMatch(/用户提问|前一轮回复|内部思考|系统交付重复消息|private-model/);
});
it("retains failed output explanations in a turn copy", () => {
  const view = { ...emptyAgentState(), messages: [message("end", "本轮生成未完成")], media: [{ generationId: 1, runId: "r", status: "failed", mediaType: "image" as const, model: "m", nodeIds: [], outputs: [], createdAt: "2026-10-14T11:58:00Z", error: "上游服务超时" }] };
  expect(buildTurnCopyText(view, "r", "http://localhost:3100")).toContain("上游服务超时");
});
it("uses persisted completion time and later asynchronous delivery without inventing missing times", () => {
  const view = { ...emptyAgentState(), finishedAtByRun: { r: "2026-10-14T11:58:00Z", old: "2026-10-14T11:40:00Z" }, messages: [message("answer", "已提交"), message("r:media:completed", "已交付", "2026-10-14T11:59:00Z")] };
  expect(getTurnFinishedAt(view, "r")).toBe("2026-10-14T11:59:00.000Z");
  expect(getTurnFinishedAt(view, "old")).toBe("2026-10-14T11:40:00.000Z");
  expect(getTurnFinishedAt(view, "missing")).toBeNull();
});

const settledMedia = [{ generationId:1,runId:'r',status:'success',mediaType:'image' as const,model:'m',nodeIds:['n'],outputs:[{url:'/one.png',nodeId:'n'}],createdAt:'2026-10-16' }];
it.each(['queued','running','waiting_decision','waiting_action','paused','stopping',undefined] as const)('does not infer whole-turn completion from settled receipts while status is %s',status=>{
 const summary=summarizeMediaOutcomes(settledMedia,status);
 expect(summary).toContain('已生成 1 张图片');expect(summary).not.toContain('本轮生成任务已结束');
 if(status==='waiting_decision')expect(summary).toContain('仍有后续操作等待你的确认或回答');
});
it.each(['completed','failed','stopped'] as const)('reports real terminal status %s without manufacturing planned outputs',status=>{
 const summary=summarizeMediaOutcomes(settledMedia,status);
 expect(summary).toContain('已生成 1 张图片');expect(summary).toContain('已结束');
});
it('keeps snapshot refresh and copy scoped to the actual current run, never an old completion message',()=>{
 const snapshot:any={sessionId:'s',run:{id:'r',sessionId:'s',canvasId:1,status:'waiting_decision',createdAt:'2026-10-16',updatedAt:'2026-10-16'},latestSequence:0,media:settledMedia,messages:[message('r:media:completed','本轮生成任务已结束：1项成功。')],mediaPending:false};
 const view=restoreAgentSnapshot(JSON.parse(JSON.stringify(snapshot)));
 const copy=buildTurnCopyText(view,'r','http://localhost');
 expect(copy).toContain('仍有后续操作等待你的确认或回答');expect(copy).not.toContain('本轮生成任务已结束');
 const historical=buildTurnCopyText({...view,run:{...view.run!,id:'another',status:'completed'}},'r','http://localhost');
 expect(historical).not.toContain('已结束');expect(historical).toContain('已生成 1 张图片');
});
it.each(['unknown','running','pending'])('does not fabricate a terminal summary for %s media even if the run ended',status=>{
 expect(summarizeMediaOutcomes([{...settledMedia[0],status,outputs:[]}],'completed')).toBeNull();
});
