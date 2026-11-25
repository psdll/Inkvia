import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { providerErrorSensitiveValues, sanitizeProviderErrorFields, sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import {
  axiosWithProviderEgress,
  resolveProviderRequestContext,
  type ProviderEgressDecision,
} from "@/lib/providers/transport";

export type KieCreateTaskResult = {
  taskId: string;
};

export type KieTaskState = "waiting" | "queuing" | "generating" | "success" | "fail";

export type KieRecordInfo = {
  taskId: string;
  model: string;
  state: KieTaskState;
  resultJson: string | null;
  failCode: string | null;
  failMsg: string | null;
};

async function resolveKieEndpoint() {
  const context = await resolveProviderRequestContext("kie");
  const base = String(context.provider.baseUrl || process.env.KIE_BASE_URL || "https://api.kie.ai")
    .trim()
    .replace(/\/+$/, "");
  const apiKey = resolvedProviderApiKey(context.provider);
  return { base, apiKey, decision: context.decision };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyKieErrorDetail(data: any) {
  const detail = typeof data?.data === "string"
    ? data.data
    : typeof data?.error === "string"
      ? data.error
      : typeof data?.message === "string"
        ? data.message
        : "";
  return String(detail || "").trim();
}

async function postKieWithRetry(
  url: string,
  body: any,
  fallbackMessage: string,
  apiKey: string,
  decision: ProviderEgressDecision,
) {
  // createTask is non-idempotent: an automatic retry can create duplicate paid jobs.
  const maxAttempts = 1;
  let lastError = "";
  const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, url);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await axiosWithProviderEgress(decision, {
      url,
      method: "POST",
      data: body,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 45000,
      validateStatus: () => true
    });
    const data = sanitizeProviderErrorFields(res.data as any, sensitiveValues);
    if (res.status === 200 && data?.code === 200) {
      return data;
    }

    const msg = data?.msg || data?.message || `${fallbackMessage}（${res.status}）`;
    const detail = stringifyKieErrorDetail(data);
    lastError = sanitizeProviderErrorText(
      detail ? `${msg}: ${detail}` : msg,
      sensitiveValues,
      fallbackMessage,
    );
    const shouldRetry = [429, 500, 502, 503, 504].includes(res.status);
    if (!shouldRetry || attempt >= maxAttempts) {
      throw new Error(lastError);
    }
    await sleep(attempt * 1200);
  }

  throw new Error(lastError || fallbackMessage);
}

export async function kieCreateTask(body: any): Promise<KieCreateTaskResult> {
  const { base, apiKey, decision } = await resolveKieEndpoint();
  const data = await postKieWithRetry(`${base}/api/v1/jobs/createTask`, body, "Kie createTask 失败", apiKey, decision);
  const taskId = String(data?.data?.taskId || "");
  if (!taskId) throw new Error("Kie createTask 未返回 taskId");
  return { taskId };
}

export async function kieGetTaskDetail(taskId: string): Promise<KieRecordInfo> {
  const { base, apiKey, decision } = await resolveKieEndpoint();
  const url = `${base}/api/v1/jobs/recordInfo`;
  const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, base, url);
  const res = await axiosWithProviderEgress(decision, {
    url,
    method: "GET",
    params: { taskId },
    headers: { Authorization: `Bearer ${apiKey}` },
    validateStatus: () => true
  });
  const data = sanitizeProviderErrorFields(res.data as any, sensitiveValues);
  if (res.status !== 200 || data?.code !== 200) {
    const msg = data?.msg || data?.message || `Kie recordInfo 失败（${res.status}）`;
    throw new Error(sanitizeProviderErrorText(msg, sensitiveValues, `Kie recordInfo 失败（${res.status}）`));
  }
  const d = data?.data || {};
  return {
    taskId: String(d.taskId || taskId),
    model: String(d.model || ""),
    state: String(d.state || "waiting") as KieTaskState,
    resultJson: d.resultJson ? String(d.resultJson) : null,
    failCode: d.failCode ? String(d.failCode) : null,
    failMsg: d.failMsg ? String(d.failMsg) : null
  };
}
