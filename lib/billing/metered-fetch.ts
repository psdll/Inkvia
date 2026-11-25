import { fetchWithProviderEgress } from "@/lib/providers/transport";
import { beginLlmCost, finishLlmCost } from "./llm";
import type { TokenUsage } from "./money";

// Used only by the legacy LLM transports. The routed gateway meters its calls itself.
export async function fetchWithLlmBilling(
  decision: Parameters<typeof fetchWithProviderEgress>[0],
  url: Parameters<typeof fetchWithProviderEgress>[1],
  init?: Parameters<typeof fetchWithProviderEgress>[2],
  billingIdentity?: { authUserId?: number; userId?: string },
): Promise<Response> {
  const request = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  const call = await beginLlmCost({
    provider: decision.providerId,
    model: String(request.model || "unknown"),
    source: "legacy_llm",
    ...billingIdentity,
  });
  let response: Response;
  try {
    response = await fetchWithProviderEgress(decision, url, init);
  } catch (error) {
    await finishLlmCost(call, null, false).catch((e) =>
      console.error("[billing] legacy settlement pending", {
        id: call.id,
        error: e,
      }),
    );
    throw error;
  }
  if (!response.body) {
    await finishLlmCost(call, null, false);
    return response;
  }
  const reader = response.body.getReader();
  const stream = response.headers
    .get("content-type")
    ?.includes("text/event-stream");
  const decoder = new TextDecoder();
  let buffer = "",
    settled = false;
  let usage: TokenUsage = { inputTokens: null, outputTokens: null };
  let successful = response.ok;
  const collect = (payload: any) => {
    if (payload?.error || payload?.type === "error" || payload?.response?.error)
      successful = false;
    const u =
      payload?.usage ||
      payload?.message?.usage ||
      payload?.response?.usage ||
      payload?.data?.usage;
    if (!u) return;
    const count = (v: unknown) =>
      typeof v === "number" && Number.isSafeInteger(v) && v >= 0
        ? v
        : undefined;
    const input = count(u.prompt_tokens ?? u.input_tokens),
      output = count(u.completion_tokens ?? u.output_tokens);
    const cached = count(
      u.prompt_tokens_details?.cached_tokens ??
        u.prompt_cache_hit_tokens ??
        u.input_tokens_details?.cached_tokens ??
        u.cache_read_input_tokens,
    );
    const created = count(u.cache_creation_input_tokens);
    const anthropic =
      "cache_read_input_tokens" in u || "cache_creation_input_tokens" in u;
    if (input !== undefined)
      usage.inputTokens =
        input + (anthropic ? (cached || 0) + (created || 0) : 0);
    if (output !== undefined) usage.outputTokens = output;
    if (cached !== undefined) usage.cachedInputTokens = cached;
    if (created !== undefined) usage.cacheCreationInputTokens = created;
  };
  const consume = (chunk: string, final = false) => {
    buffer += chunk;
    if (stream) {
      const lines = buffer.split(/\r?\n/);
      buffer = final ? "" : lines.pop() || "";
      for (const line of lines)
        if (line.startsWith("data:")) {
          try {
            collect(JSON.parse(line.slice(5)));
          } catch {}
        }
    } else if (final) {
      try {
        collect(JSON.parse(buffer));
      } catch {}
      buffer = "";
    }
    // Only transient response bytes; never persist prompts, output text or credentials.
    if (buffer.length > 4 * 1024 * 1024) {
      buffer = "";
      successful = false;
    }
  };
  const settle = async (ok: boolean) => {
    if (settled) return;
    settled = true;
    await finishLlmCost(call, usage, ok).catch((error) =>
      console.error("[billing] legacy settlement pending", {
        id: call.id,
        error,
      }),
    );
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          consume(decoder.decode(), true);
          await settle(successful);
          controller.close();
          return;
        }
        consume(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      } catch (error) {
        await settle(false);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await settle(false);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
