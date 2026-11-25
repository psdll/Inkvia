import { expect, it } from "vitest";
import type { CreativeAgentMessage } from "@/lib/creative-agent/contracts";
import type { AgentTool } from "@/components/creative-agent/state";
import { groupThinkingMessages } from "@/components/creative-agent/thinking-groups";

const thought = (id: string, overrides: Partial<CreativeAgentMessage> = {}): CreativeAgentMessage => ({ id, role: "assistant", text: "", runId: "run", createdAt: "2026-10-14T12:00:00Z", thinking: { content: id, duration: 2 }, ...overrides });
const empty = new Map<string, AgentTool[]>();

it("combines adjacent thinking into the following reply without changing saved message IDs or content", () => {
  const messages = [thought("a"), thought("b"), thought("c", { text: "最终回复" })];
  const saved = structuredClone(messages);
  const groups = groupThinkingMessages(messages, empty, empty);
  expect(groups).toEqual([{ firstMessageId: "a", message: { ...messages[2], thinking: { content: "a\n\nb\n\nc", duration: 6 } } }]);
  expect(messages).toEqual(saved);
});

it.each([
  thought("b", { role: "user", text: "新的提问", thinking: undefined }),
  thought("b", { runId: "another-run" }),
  thought("b", { runId: undefined }),
  thought("b", { references: [{ canvasId: 1, nodeId: "n", label: "素材", kind: "image" }] }),
])("does not group across user, run or reference boundaries %#", boundary => {
  expect(groupThinkingMessages([thought("a"), boundary, thought("c")], empty, empty).map(group => group.firstMessageId)).toEqual(["a", "b", "c"]);
});

it("keeps thinking after a visible reply in a new group", () => {
  const groups = groupThinkingMessages([thought("a", { text: "进度说明" }), thought("b"), thought("c")], empty, empty);
  expect(groups.map(group => group.firstMessageId)).toEqual(["a", "b"]);
  expect(groups[0].message.text).toBe("进度说明");
  expect(groups[1].message.thinking?.content).toBe("b\n\nc");
});

it.each(["before", "after"])("keeps a visible tool or answered question at its original %s boundary", position => {
  const tools = new Map<string, AgentTool[]>([[position === "before" ? "b" : "a", [{ id: "ask", title: "已询问", status: "completed", nodeIds: [] }]]]);
  expect(groupThinkingMessages([thought("a"), thought("b")], position === "before" ? tools : empty, position === "after" ? tools : empty)).toHaveLength(2);
});

it("uses the latest streaming state and does not double-count duration when the last phase updates", () => {
  const messages = [thought("a"), thought("b", { thinking: { content: "正在整理", duration: 1, streaming: true } })];
  expect(groupThinkingMessages(messages, empty, empty)[0]).toMatchObject({ firstMessageId: "a", message: { id: "b", thinking: { duration: 3, streaming: true } } });
  const finished = groupThinkingMessages([messages[0], thought("b", { thinking: { content: "已整理", duration: 4, streaming: false } }), thought("c", { text: "交付结果", thinking: undefined })], empty, empty);
  expect(finished).toHaveLength(1);
  expect(finished[0]).toMatchObject({ firstMessageId: "a", message: { id: "c", text: "交付结果", thinking: { content: "a\n\n已整理", duration: 6, streaming: false } } });
});

it("omits the total if a historical phase has no duration instead of presenting a partial total", () => {
  const groups = groupThinkingMessages([thought("a", { thinking: { content: "旧记录" } }), thought("b")], empty, empty);
  expect(groups[0].message.thinking?.duration).toBeUndefined();
  expect(groups[0].message.thinking?.content).toBe("旧记录\n\nb");
});
