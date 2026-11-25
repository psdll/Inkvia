import {
  normalizeAlertmanagerAlerts,
  type AlertAcknowledgement,
  type MonitoringAlert,
} from "@/lib/monitoring/fault-guidance";

async function responseJson(response: Response, maximumBytes = 2 * 1024 * 1024) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new Error("告警响应过大");
  if (!response.ok) throw new Error(`Alertmanager 请求失败 (${response.status})`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Alertmanager 返回了无效数据");
  }
}

export async function listAlertmanagerAlerts(input: {
  endpoint: string;
  timeoutMs: number;
  acknowledgements?: Record<string, AlertAcknowledgement>;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<MonitoringAlert[]> {
  const url = new URL("/api/v2/alerts", input.endpoint);
  const response = await (input.fetchImpl || fetch)(url.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  return normalizeAlertmanagerAlerts(
    await responseJson(response),
    input.acknowledgements,
    input.now,
  );
}

const MATCHER_LABELS = ["alertname", "service", "component", "instance"] as const;

export async function createAlertmanagerSilence(input: {
  endpoint: string;
  timeoutMs: number;
  alert: MonitoringAlert;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  comment: string;
  fetchImpl?: typeof fetch;
}) {
  const matchers = MATCHER_LABELS.flatMap((name) => {
    const value = input.alert.labels[name];
    return value ? [{ name, value, isRegex: false, isEqual: true }] : [];
  });
  if (!matchers.some((matcher) => matcher.name === "alertname")) {
    throw new Error("告警缺少可静默的名称标签");
  }

  const url = new URL("/api/v2/silences", input.endpoint);
  const response = await (input.fetchImpl || fetch)(url.toString(), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      matchers,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdBy: input.createdBy.slice(0, 120),
      comment: input.comment.slice(0, 500),
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  const payload = await responseJson(response, 64 * 1024);
  const silenceId = String(payload?.silenceID || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(silenceId)) throw new Error("Alertmanager 未返回有效静默编号");
  return { silenceId };
}
