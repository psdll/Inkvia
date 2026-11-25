import { describe, expect, it } from "vitest";
import { emptyAgentState, type AgentViewState } from "@/components/creative-agent/state";
import { describeAgentActivity } from "@/components/creative-agent/activity";

const view = (): AgentViewState => ({ ...emptyAgentState(), run: { id: "current", sessionId: "s", canvasId: 1, status: "running", createdAt: "2026-10-14", updatedAt: "2026-10-14" } });
describe("concise creative progress", () => {
  it("starts with understanding the request and uses the current real tool stage", () => {
    const state = view();
    expect(describeAgentActivity(state)?.label).toBe("正在理解你的需求");
    state.tools = [{ id: "read", runId: "current", name: "media.inspect", title: "观察引用素材", status: "running", nodeIds: [] }];
    expect(describeAgentActivity(state)?.label).toBe("正在查看参考素材");
    state.tools[0].status = "completed";
    expect(describeAgentActivity(state)?.label).toBe("正在整理创作方案");
  });
  it("does not reuse an older run's activity or invent a task count from the user's request", () => {
    const state = view();
    state.tools = [{ id: "old", runId: "old", name: "image.generate", title: "生成图片", status: "running", nodeIds: [] }];
    state.messages = [{ id: "user", role: "user", text: "来三张高端客厅图片", createdAt: "2026-10-14" }];
    expect(describeAgentActivity(state)).toEqual({ label: "正在理解你的需求" });
  });
  it("counts only registered generation tasks, including partial completion and failure", () => {
    const state = view();
    state.media = ["success", "running", "failed"].map((status, index) => ({ generationId: index + 1, runId: "current", status, mediaType: "image", model: "model", nodeIds: [], outputs: [], createdAt: "2026-10-14" }));
    state.media.push({ ...state.media[0], generationId: 99, runId: "old" });
    expect(describeAgentActivity(state)).toEqual({ label: "正在生成图片", detail: "3 项任务 · 1 项完成 · 1 项进行中 · 1 项失败" });
    state.media[1].status = "success";
    expect(describeAgentActivity(state)?.label).toBe("正在整理生成结果");
  });
  it("does not override pauses, decisions or terminal status with an old running tool", () => {
    for (const status of ["paused", "waiting_decision", "completed", "failed", "stopped", "stopping"] as const) {
      const state = view(); state.run!.status = status;
      state.tools = [{ id: "tool", runId: "current", name: "image.generate", title: "生成图片", status: "running", nodeIds: [] }];
      expect(describeAgentActivity(state)).toBeNull();
    }
  });
  it("distinguishes writing a response from waiting for generated outputs", () => {
    const state = view();
    state.messages = [{ id: "response", role: "assistant", text: "这次按高端真实客厅的方向", runId: "current", createdAt: "2026-10-14" }];
    expect(describeAgentActivity(state)?.label).toBe("正在撰写回复");
    state.run!.status = "waiting_action";
    expect(describeAgentActivity(state)?.label).toBe("正在等待任务结果");
  });
  it("R26 describes the real skill operation and authorized primary path while it is running", () => {
    const state = view();
    const activity = { category: "skill" as const, operation: "prepared" as const, origin: "input_expansion" as const, selectionOrigin: "user" as const, name: "场景方法", skillId: "personal:21", revision: 5, path: "guide.md", primaryPath: "guide.md", purpose: "加载本轮所选技能" };
    state.tools = [{ id: "load", runId: "current", name: "skillOperator", title: "读取技能资料", status: "running", nodeIds: [], activity }];
    expect(describeAgentActivity(state)?.label).toBe("正在加载技能 · 场景方法");
    state.tools[0].activity = { ...activity, operation: "read", origin: "tool_call" };
    expect(describeAgentActivity(state)?.label).toBe("正在读取主文件 · 场景方法 / guide.md");
    state.tools[0].activity = { ...state.tools[0].activity, path: "references/light.md" };
    expect(describeAgentActivity(state)?.label).toBe("正在读取技能资料 · references/light.md");
    state.tools[0].activity = { ...state.tools[0].activity, primaryPath: undefined, path: "legacy.md" };
    expect(describeAgentActivity(state)?.label).toBe("正在读取技能资料 · legacy.md");
  });
});
