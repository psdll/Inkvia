import { describe, expect, it } from "vitest";
import {
  applyAgentEvents,
  finishAgentEventDrain,
  restoreAgentSnapshot,
  emptyAgentState,
} from "@/components/creative-agent/state";
import type {
  CreativeAgentEvent,
  CreativeAgentRun,
} from "@/lib/creative-agent/contracts";
const run: CreativeAgentRun = {
  id: "run",
  sessionId: "session",
  canvasId: 1,
  status: "running",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const event = (
  sequence: number,
  type: CreativeAgentEvent["type"],
  payload: Record<string, unknown>,
): CreativeAgentEvent => ({
  sequence,
  type,
  payload,
  runId: run.id,
  createdAt: run.createdAt,
});
describe("canvas Agent event recovery", () => {
  it("replaces an edited turn and removes its stale replies and decisions while preserving earlier turns", () => {
    const user = { id: "user", role: "user" as const, runId: run.id, text: "旧要求", createdAt: run.createdAt };
    const earlier = { ...user, id: "earlier", runId: "previous", text: "前一轮" };
    const state = applyAgentEvents({ ...emptyAgentState(), messages: [earlier, user] }, [
      event(1, "message.completed", { message: { id: "old-answer", role: "assistant", text: "旧方案" } }),
      event(2, "tool.started", { actionId: "old-tool", name: "canvas.read" }),
      event(3, "decision.requested", { decisionId: "old-decision", question: "旧问题" }),
    ], run);
    const revised = { ...user, text: "新要求" };
    const next = applyAgentEvents(state, [event(4, "message.revised", { message: revised }), event(5, "text.delta", { messageId: "new-answer", delta: "新方案" })], run);
    expect(next.messages).toEqual([earlier, revised, expect.objectContaining({ id: "new-answer", text: "新方案" })]);
    expect(next.tools).toEqual([]);
    expect(next.decision).toBeNull();
    expect(next.completedIds).not.toContain("old-answer");
    expect(applyAgentEvents(next, [event(3, "text.delta", { messageId: "old-answer", delta: "迟到的旧方案" })], run)).toEqual(next);
  });
  it("keeps completion times when moving to another run and restoring history", () => {
    const completed = { ...run, status: "completed" as const, updatedAt: "2026-10-14T11:58:00Z" };
    const done = applyAgentEvents(emptyAgentState(), [], completed);
    expect(done.finishedAtByRun?.run).toBe(completed.updatedAt);
    const following = applyAgentEvents(done, [], { ...run, id: "next" });
    expect(following.finishedAtByRun?.run).toBe(completed.updatedAt);
    const restored = restoreAgentSnapshot({ sessionId: "session", run: null, messages: [], latestSequence: 0, finishedAtByRun: { run: completed.updatedAt } });
    expect(restored.finishedAtByRun).toEqual(done.finishedAtByRun);
  });
  it("replays completed transcript without duplicating text or messages", () => {
    const state = restoreAgentSnapshot({
      sessionId: "session",
      run,
      latestSequence: 3,
      messages: [
        { id: "m", role: "assistant", text: "完成", createdAt: run.createdAt },
      ],
    });
    const events = [
      event(1, "text.delta", { messageId: "m", delta: "完" }),
      event(2, "text.delta", { messageId: "m", delta: "成" }),
      event(3, "message.completed", { message: { id: "m", text: "完成" } }),
    ];
    const next = applyAgentEvents(state, events, run);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].text).toBe("完成");
    expect(applyAgentEvents(next, events, run)).toEqual(next);
  });
  it("orders sequence batches, rejects foreign runs, and replaces tool status by durable action ID", () => {
    const next = applyAgentEvents(
      emptyAgentState(),
      [
        event(3, "tool.completed", { actionId: "a", nodeIds: ["n"] }),
        event(2, "text.delta", { messageId: "m", delta: "你好" }),
        event(1, "tool.started", { actionId: "a", name: "canvas.create", title: "创作角色" }),
        { ...event(4, "text.delta", { delta: "错误" }), runId: "foreign" },
      ],
      run,
    );
    expect(next.messages[0].text).toBe("你好");
    expect(next.sequence).toBe(3);
    expect(next.tools).toMatchObject([
      {
        id: "a",
        name: "canvas.create",
        title: "创作角色",
        detail: undefined,
        status: "completed",
        nodeIds: ["n"],
      },
    ]);
  });
  it("marks runtime tool.completed error as failed instead of completed", () => {
    const next = applyAgentEvents(
      emptyAgentState(),
      [
        event(1, "tool.started", { actionId: "a", title: "生成图片" }),
        event(2, "tool.completed", {
          actionId: "a",
          status: "error",
          detail: "执行结果未确认，已暂停",
        }),
      ],
      run,
    );
    expect(next.tools).toMatchObject([
      {
        id: "a",
        title: "生成图片",
        detail: "执行结果未确认，已暂停",
        status: "failed",
        nodeIds: [],
      },
    ]);
  });
  it("removes only unconfirmed current-run assistant fragments after terminal event drain", () => {
    const message = (
      id: string,
      role: "assistant" | "user",
      runId = run.id,
    ) => ({ id, role, runId, text: "相同正文", createdAt: run.createdAt });
    const state = {
      ...emptyAgentState(),
      run: { ...run, status: "completed" as const },
      completedIds: ["final-a", "final-b"],
      messages: [
        message("user", "user"),
        message("old-epoch", "assistant"),
        message("final-a", "assistant"),
        message("final-b", "assistant"),
        message("other-run", "assistant", "other"),
      ],
    };
    const next = finishAgentEventDrain(state);
    expect(next.messages.map((message) => message.id)).toEqual([
      "user",
      "final-a",
      "final-b",
      "other-run",
    ]);
    expect(next.completedIds).toEqual(state.completedIds);
  });
  it.each(["running", "paused"] as const)(
    "retains an unconfirmed assistant stream when run is %s",
    (status) => {
      const state = applyAgentEvents(
        emptyAgentState(),
        [event(1, "text.delta", { messageId: "partial", delta: "尚未结束" })],
        { ...run, status },
      );
      expect(finishAgentEventDrain(state)).toBe(state);
      expect(state.messages[0].text).toBe("尚未结束");
    },
  );
  it("requires a concrete proposal hash and clears decisions after leaving the waiting state", () => {
    const waiting = { ...run, status: "waiting_decision" as const };
    expect(
      applyAgentEvents(
        emptyAgentState(),
        [
          event(1, "decision.requested", {
            decisionId: "d",
            question: "确认？",
          }),
        ],
        waiting,
      ).decision,
    ).toBeNull();
    const next = applyAgentEvents(
      emptyAgentState(),
      [
        event(1, "decision.requested", {
          decisionId: "d",
          proposalHash: "h",
          question: "确认？",
          options: [{ value: "yes", label: "继续" }],
        }),
      ],
      waiting,
    );
    expect(next.decision?.proposalHash).toBe("h");
    expect(applyAgentEvents(next, [], run).decision).toBeNull();
  });
});
