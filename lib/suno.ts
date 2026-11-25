import "server-only";
import { resolveApimartEndpoint } from "@/lib/apimart-image";
import { fetchWithProviderEgress } from "@/lib/providers/transport";
import { providerErrorSensitiveValues, sanitizeProviderErrorFields, sanitizeProviderErrorText } from "@/lib/providers/error-safety";

export class SunoRequestError extends Error {
  constructor(message: string, public readonly rejected: boolean) { super(message); }
}
async function request(path: string, body?: Record<string, unknown>) {
  const { base, apiKey, decision } = await resolveApimartEndpoint();
  const url = `${base.replace(/\/v1$/, "")}/v1/music/${path}`;
  const sensitive = providerErrorSensitiveValues(decision, url, apiKey);
  const response = await fetchWithProviderEgress(decision, url, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body ? 60_000 : 30_000),
  });
  const raw = await response.json().catch(() => null);
  const data = sanitizeProviderErrorFields(raw, sensitive);
  if (!response.ok || (data?.code != null && Number(data.code) !== 200)) throw new SunoRequestError(
    sanitizeProviderErrorText(data?.error?.message || data?.message || "Suno 请求失败", sensitive),
    response.status >= 400 && response.status < 500,
  );
  return data;
}
export async function submitSuno(body: Record<string, unknown>) {
  const result = await request("generations", body);
  const taskId = result?.data?.[0]?.task_id;
  if (typeof taskId !== "string" || !taskId.trim()) throw new SunoRequestError("Suno 提交结果待核实，请勿重复生成", false);
  return taskId;
}
export const getSunoTask = (taskId: string) => request(`tasks/${encodeURIComponent(taskId)}?language=zh`);
