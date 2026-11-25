import type { CreativeAgentEventsResponse } from "./contracts";

/** Resolves true only once all terminal events were delivered and acknowledged. */
export async function streamCreativeEvents(
  runId: string,
  after: number,
  signal: AbortSignal,
  receive: (batch: CreativeAgentEventsResponse) => Promise<void>,
): Promise<boolean> {
  const response = await fetch(
    `/api/creative-agent/runs/${encodeURIComponent(runId)}/stream?after=${after}`,
    { signal, cache: "no-store", credentials: "same-origin" },
  );
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new Error("实时连接暂不可用");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (block.startsWith("event: complete")) return true;
        if (block.startsWith("event: reconnect")) return false;
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (data) {
          const batch = JSON.parse(data) as CreativeAgentEventsResponse;
          if (batch.run?.id !== runId || !Array.isArray(batch.events))
            throw new Error("实时消息格式无效");
          await receive(batch);
        }
      }
      if (buffer.length > 4_000_000)
        throw new Error("实时消息过大，请重新连接");
      if (chunk.done) return false;
    }
    return false;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
