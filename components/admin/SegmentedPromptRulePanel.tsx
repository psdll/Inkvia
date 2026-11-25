"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import {
  Braces,
  CheckCircle2,
  CircleAlert,
  FilePenLine,
  FlaskConical,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PromptSegmentParseError,
  parsePromptSegmentsV1,
  type PromptSegmentV1,
} from "@/lib/image-batch/prompt-segments";

type RuleConfig = {
  revision: number;
  source: "default" | "custom";
  ruleText: string;
  updatedAt: string | null;
};

type ParserPreviewResult =
  | { status: "idle" }
  | { status: "success"; segments: PromptSegmentV1[] }
  | { status: "error"; message: string };

type Notice = {
  type: "success" | "error" | "info";
  text: string;
};

const RULE_ENDPOINT = "/api/admin/settings/segmented-prompt-rule";
const MAX_RULE_LENGTH = 10_000;
const DEFAULT_SAMPLE = [
  "普通中国家庭客厅，按摩椅靠近窗边摆放，手机 1x 主摄自然拍摄。",
  "人物进入零重力姿态，双手与双脚正确放入按摩仓，产品结构完整。",
  "近距离拍摄屏幕、手臂气囊和腿部按摩仓细节。",
].join("\n");

async function readConfigResponse(response: Response) {
  const data = (await response.json().catch(() => null)) as {
    success?: boolean;
    config?: RuleConfig;
    error?: string;
  } | null;
  if (!response.ok || data?.success === false || !data?.config) {
    throw new Error(data?.error || "分段解析规则请求失败");
  }
  return data.config;
}

export default function SegmentedPromptRulePanel() {
  const [config, setConfig] = React.useState<RuleConfig | null>(null);
  const [customRule, setCustomRule] = React.useState("");
  const [sample, setSample] = React.useState(DEFAULT_SAMPLE);
  const [result, setResult] = React.useState<ParserPreviewResult>({
    status: "idle",
  });
  const [testedSignature, setTestedSignature] = React.useState("");
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    void fetch(RULE_ENDPOINT, { cache: "no-store", signal: controller.signal })
      .then(readConfigResponse)
      .then((next) => {
        setConfig(next);
        setCustomRule(next.ruleText);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setNotice({
          type: "error",
          text: error instanceof Error ? error.message : "读取全局规则失败",
        });
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const invalidateTest = React.useCallback(() => {
    setResult({ status: "idle" });
    setTestedSignature("");
  }, []);

  const currentSignature = `${customRule.trim()}\u0000${sample.trim()}`;
  const testedCurrentRule =
    result.status === "success" && testedSignature === currentSignature;

  const testParser = () => {
    if (!customRule.trim()) {
      setResult({ status: "error", message: "请先填写自定义解析规则。" });
      setTestedSignature("");
      return;
    }
    try {
      const segments = parsePromptSegmentsV1(sample);
      setResult({ status: "success", segments });
      setTestedSignature(currentSignature);
      setNotice({
        type: "info",
        text: "当前规则的示例输出已通过解析，可以保存并启用。",
      });
    } catch (error) {
      setResult({
        status: "error",
        message:
          error instanceof PromptSegmentParseError
            ? error.message
            : "解析失败，请检查测试内容。",
      });
      setTestedSignature("");
    }
  };

  const saveRule = async () => {
    if (!config) {
      setNotice({ type: "error", text: "当前规则尚未加载完成。" });
      return;
    }
    if (!customRule.trim()) {
      setNotice({ type: "error", text: "自定义解析规则不能为空。" });
      return;
    }
    if (!testedCurrentRule) {
      setNotice({ type: "error", text: "请先测试当前规则和示例输出，再保存启用。" });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(RULE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleText: customRule,
          expectedRevision: config.revision,
        }),
      });
      const next = await readConfigResponse(response);
      setConfig(next);
      setCustomRule(next.ruleText);
      invalidateTest();
      setNotice({ type: "success", text: `revision ${next.revision} 已保存并生效。` });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "保存全局规则失败",
      });
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = async () => {
    if (!config) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(RULE_ENDPOINT, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: config.revision }),
      });
      const next = await readConfigResponse(response);
      setConfig(next);
      setCustomRule(next.ruleText);
      invalidateTest();
      setNotice({ type: "success", text: "已恢复系统默认分段规则。" });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "恢复系统默认失败",
      });
    } finally {
      setSaving(false);
    }
  };

  const noticeClass = notice?.type === "success"
    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
    : notice?.type === "error"
      ? "border-red-500/25 bg-red-500/10 text-red-500"
      : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]";

  return (
    <section
      id="sys-segmented-prompt-rule"
      className="scroll-mt-28 rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--primary-bg)_30%,var(--border))] bg-[color-mix(in_srgb,var(--primary-bg)_10%,var(--panel-2))] text-[var(--primary-bg)]">
              <Braces className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m30c5781fbbb3" /></h3>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-xs leading-5 text-[var(--app-muted)]"><UiText id="admin.m9c9342a03def" /></p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1 text-[var(--app-muted)]">
            revision {config?.revision ?? "—"}
          </span>
          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-emerald-500">
            {loading
              ? <UiText id="admin.m465c03b272ea" />
              : config?.source === "custom"
                ? <UiText id="admin.mc359a4e9d7cc" />
                : <UiText id="admin.mbdfb39db2166" />}
          </span>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[color-mix(in_srgb,var(--primary-bg)_25%,var(--border))] bg-[color-mix(in_srgb,var(--primary-bg)_5%,var(--panel-bg))] px-5 py-4">
        <p className="text-sm font-medium text-[var(--app-fg)]"><UiText id="admin.mf8b149b3dcc8" /></p>
        <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]"><UiText id="admin.m699bfc7b3c0e" /></p>
      </div>

      {notice ? (
        <div
          role={notice.type === "error" ? "alert" : "status"}
          className={`mt-4 rounded-xl border px-3 py-2 text-xs ${noticeClass}`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)]">
        <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h5 className="text-sm font-semibold text-[var(--app-fg)]"><UiText id="admin.m2ca193bd15fd" /></h5>
              <p className="mt-1 text-xs text-[var(--app-muted)]">
                {config?.source === "custom" ? <UiText id="admin.m14d927a5d57f" /> : <UiText id="admin.m04b77083689b" />}<UiText id="admin.m0cf897089a5c" /></p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" /><UiText id="admin.m317c984c99ef" /></span>
          </div>

          <div className="p-5">
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ["01", "标题可选", "有标题继续兼容"],
                ["02", "自动边界", "逐行或空行分块"],
                ["03", "非空正文", "生成独立任务"],
              ].map(([index, label, detail]) => (
                <div
                  key={index}
                  className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-3"
                >
                  <span className="font-mono text-[10px] text-[var(--primary-bg)]">
                    {index}
                  </span>
                  <p className="mt-1 text-xs font-semibold text-[var(--app-fg)]">
                    {label}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--app-muted)]">
                    {detail}
                  </p>
                </div>
              ))}
            </div>

            <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {[
                ["无标题逐行", "没有空行时，每个非空行作为一个分段"],
                ["无标题分块", "存在空行时，以空行分隔内容块"],
                ["带标题兼容", "识别独占标题，并保留标题后的多行正文"],
                ["任务名称", "无标题内容自动命名为“分段 N”"],
                ["数量限制", "最多 50 段"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid gap-1.5 py-3 text-xs sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-4"
                >
                  <dt className="text-[var(--app-muted)]">{label}</dt>
                  <dd className="font-medium leading-5 text-[var(--app-fg)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <details className="group mt-5">
              <summary className="cursor-pointer rounded text-xs font-medium text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]">
                <span className="group-open:hidden"><UiText id="admin.mce0e0c43beeb" /></span>
                <span className="hidden group-open:inline"><UiText id="admin.m9339a538717c" /></span>
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3 text-[11px] leading-5 text-[var(--app-muted)]">
                {config?.ruleText || <UiText id="admin.md68d3554c4e0" />}
              </pre>
            </details>
          </div>
        </section>

        <section className="flex min-h-[520px] flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--panel-bg)] text-[var(--primary-bg)]">
              <FilePenLine className="h-4 w-4" />
            </span>
            <div>
              <h5 className="text-sm font-semibold text-[var(--app-fg)]"><UiText id="admin.m1c970474c7e4" /></h5>
              <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]"><UiText id="admin.m92d71022f7f1" /></p>
            </div>
          </div>

          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="custom-segment-rule"
                className="text-xs font-medium text-[var(--app-fg)]"
              ><UiText id="admin.mabc74cace629" /></label>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCustomRule(config?.ruleText || "");
                    invalidateTest();
                  }}
                  disabled={!config || saving}
                  className="h-8 px-2.5 text-[11px]"
                ><UiText id="admin.m1007ebd46705" /></Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCustomRule("");
                    invalidateTest();
                  }}
                  disabled={saving}
                  className="h-8 px-2.5 text-[11px]"
                ><UiText id="admin.m1ef3de06b32e" /></Button>
              </div>
            </div>
            <UiProps ids={{"aria-label":["admin.mabc74cace629"],"placeholder":["admin.me742affa12bf"]}}><textarea
              id="custom-segment-rule"
              aria-label="admin.mabc74cace629"
              value={customRule}
              maxLength={MAX_RULE_LENGTH}
              disabled={loading || saving}
              onChange={(event) => {
                setCustomRule(event.target.value);
                invalidateTest();
              }}
              placeholder="admin.me742affa12bf"
              className="mt-2 min-h-96 flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3.5 py-3 font-mono text-xs leading-6 text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)] focus:border-[var(--primary-bg)] disabled:opacity-60"
            /></UiProps>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-2 text-[11px] leading-5 text-[var(--app-muted)]">
              <span><UiText id="admin.m305fa12c6d02" /></span>
              <span>{customRule.length} / {MAX_RULE_LENGTH}<UiText id="admin.m457271dfe88b" /></span>
            </div>
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--panel-bg)] text-[var(--primary-bg)]">
              <FlaskConical className="h-4 w-4" />
            </span>
            <div>
              <h5 className="text-sm font-semibold text-[var(--app-fg)]"><UiText id="admin.m30e8e6697b03" /></h5>
              <p className="mt-1 text-xs text-[var(--app-muted)]"><UiText id="admin.m9882223ee3c3" /></p>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={testParser}
            disabled={loading || saving}
            className="h-9 gap-1.5 px-3 text-xs"
          >
            <FlaskConical className="h-3.5 w-3.5" /><UiText id="admin.ma2ae77552adb" /></Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <UiProps ids={{"aria-label":["admin.ma4185868e0b6"]}}><textarea
            aria-label="admin.ma4185868e0b6"
            value={sample}
            disabled={loading || saving}
            onChange={(event) => {
              setSample(event.target.value);
              invalidateTest();
            }}
            className="min-h-48 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-3 font-mono text-xs leading-5 text-[var(--app-fg)] outline-none focus:border-[var(--primary-bg)] disabled:opacity-60"
          /></UiProps>

          <div className="min-h-48 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
            {result.status === "idle" ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center text-center text-[var(--app-muted)]">
                <Braces className="h-5 w-5" />
                <p className="mt-2 text-xs"><UiText id="admin.m81e4af32f9b9" /></p>
              </div>
            ) : null}
            {result.status === "error" ? (
              <div
                role="alert"
                className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-3 text-xs text-red-500"
              >
                <div className="flex items-center gap-2 font-medium">
                  <CircleAlert className="h-4 w-4" /><UiText id="admin.m0b38a5f4597a" /></div>
                <p className="mt-2 leading-5">{result.message}</p>
              </div>
            ) : null}
            {result.status === "success" ? (
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-500">
                  <CheckCircle2 className="h-4 w-4" /><UiText id="admin.me75a3afa1315" />{result.segments.length}<UiText id="admin.m03b7163f76aa" /></div>
                <div className="mt-3 space-y-2">
                  {result.segments.map((segment) => (
                    <div
                      key={segment.index}
                      className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5"
                    >
                      <p className="text-xs font-medium text-[var(--app-fg)]">
                        {segment.index}. {segment.name}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--app-muted)]">
                        {segment.prompt}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <p className="max-w-2xl text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m6f75859f3bf2" /></p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void resetDefaults()}
            disabled={!config || saving || config.source === "default"}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}<UiText id="admin.m381b2dade295" /></Button>
          <Button
            onClick={() => void saveRule()}
            disabled={!config || saving}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}<UiText id="admin.m8e3f6f877243" /></Button>
        </div>
      </div>
    </section>
  );
}
