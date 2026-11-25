import type { CreativeAgentMessage } from "@/lib/creative-agent/contracts";
import type { AgentTool } from "./state";

/** Group only the display; persisted messages and their completion IDs stay intact. */
export function groupThinkingMessages(
  messages: CreativeAgentMessage[],
  toolsBefore: ReadonlyMap<string, AgentTool[]>,
  toolsAfter: ReadonlyMap<string, AgentTool[]>,
) {
  const groups: { firstMessageId: string; message: CreativeAgentMessage }[] = [];
  for (const message of messages) {
    const previous = groups[groups.length - 1];
    const prior = previous?.message;
    if (prior?.role === "assistant" && message.role === "assistant" &&
      prior.runId && prior.runId === message.runId && !prior.text.trim() && prior.thinking?.content &&
      !prior.references?.length && !message.references?.length &&
      !toolsAfter.has(prior.id) && !toolsBefore.has(message.id)) {
      const thinking = message.thinking;
      previous.message = {
        ...message,
        thinking: thinking?.content ? {
          ...thinking,
          content: `${prior.thinking.content}\n\n${thinking.content}`,
          duration: typeof prior.thinking.duration === "number" && Number.isFinite(prior.thinking.duration) &&
            typeof thinking.duration === "number" && Number.isFinite(thinking.duration)
            ? prior.thinking.duration + thinking.duration : undefined,
        } : { ...prior.thinking, streaming: false },
      };
    } else groups.push({ firstMessageId: message.id, message });
  }
  return groups;
}
