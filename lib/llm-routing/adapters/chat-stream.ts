export type LlmDelta = { kind: "analysis" | "text"; text: string };
export class ChatStreamError extends Error {
  constructor(
    message: string,
    public usagePayload: unknown,
  ) {
    super(message);
  }
}

/** Read one response only. A truncated stream must never become an executable plan. */
export async function readChatStream(
  response: Response,
  onDelta: (delta: LlmDelta) => Promise<void>,
) {
  if (!response.body) throw new Error("LLM_STREAM_EMPTY");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [],
    text = "",
    finished = false,
    incomplete = false,
    doneMarker = false,
    received = 0;
  let usage: unknown;
  async function dispatch() {
    const value = data.join("\n");
    data = [];
    if (!value) return;
    if (value === "[DONE]") {
      doneMarker = true;
      return;
    }
    const chunk = JSON.parse(value);
    if (chunk.error) throw new Error("LLM_STREAM_UPSTREAM_ERROR");
    if (chunk.usage) usage = chunk.usage;
    const choice =
      chunk.choices?.find((item: any) => item.index === 0) ||
      chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) {
      if (choice.finish_reason !== "stop") incomplete = true;
      finished = true;
    }
    const delta = choice.delta;
    if (typeof delta?.reasoning_content === "string")
      await onDelta({ kind: "analysis", text: delta.reasoning_content });
    if (typeof delta?.content === "string") {
      text += delta.content;
      if (text.length > 1_000_000) throw new Error("LLM_STREAM_TOO_LARGE");
      await onDelta({ kind: "text", text: delta.content });
    }
  }
  async function line(value: string) {
    if (!value) await dispatch();
    else if (value.startsWith("data:"))
      data.push(value.slice(5).replace(/^ /, ""));
  }
  try {
    while (!doneMarker) {
      const next = await reader.read();
      const decoded = decoder.decode(next.value, { stream: !next.done });
      received += decoded.length;
      if (received > 2_000_000) throw new Error("LLM_STREAM_TOO_LARGE");
      buffer += decoded;
      if (buffer.length > 1_000_000) throw new Error("LLM_STREAM_TOO_LARGE");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        await line(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
      }
      if (next.done) {
        if (buffer) await line(buffer.replace(/\r$/, ""));
        await dispatch();
        break;
      }
    }
    if (!finished || incomplete || !text)
      throw new Error("LLM_STREAM_INCOMPLETE");
    return { choices: [{ message: { content: text } }], usage };
  } catch (error) {
    if (
      error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name)
    )
      throw error;
    throw new ChatStreamError("LLM_STREAM_INVALID_OR_INTERRUPTED", usage);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
