"use client";
import { UiText } from "@/i18n/ui";
import type { UiLocale } from "@/i18n/locale";
import { formatUiError, formatUiLabel } from "@/i18n/source-messages";


import { Loader2 } from "lucide-react";
import {
  isScenarioBoundToModel,
  type AdminLlmBinding,
  type AdminLlmScenarioView,
} from "@/lib/providers/admin-ui";

export type InlineRouteAction = {
  kind: "busy" | "success" | "error" | "sync_failed";
  providerId: string;
  modelId: string;
  message?: string;
};

type Props = {
  locale?: UiLocale;
  align?: "start" | "end";
  compact?: boolean;
  providerId: string;
  modelId: string;
  scenarios: AdminLlmScenarioView[];
  disabled: boolean;
  draftBindings?: Record<string, AdminLlmBinding>;
  allowDraftSelection?: boolean;
  actionByScenario: Record<string, InlineRouteAction>;
  onActivate: (scenarioId: string, binding: AdminLlmBinding) => void;
};

const INLINE_LLM_SCENARIO_LABELS: Record<string, string> = {
  "image.role_prompt": "创作、批量技能",
};

// Agent chat has its own admin page; canvas text models follow the 模型显示 switches,
// so neither is offered as a per-model "使用范围" choice here.
const HIDDEN_INLINE_SCENARIOS = new Set(["agent.chat", "canvas.chat"]);

function unavailableTitle(status: string | undefined) {
  if (status === "unsupported-capability") return "当前不可用：该模型不支持此功能所需能力";
  if (status === "missing-key") return "当前不可用：缺少此模型所需的访问凭据";
  return `当前不可用：${status ?? "missing-binding"}`;
}

export function ProviderLlmUsageTags({
  locale = "zh-CN",
  align = "end",
  compact = false,
  providerId,
  modelId,
  scenarios,
  disabled,
  draftBindings = {},
  allowDraftSelection = false,
  actionByScenario,
  onActivate,
}: Props) {
  const label = (value: string) => formatUiLabel(locale, value);
  const rowActions = Object.entries(actionByScenario).filter(([scenarioId, action]) => (
    !HIDDEN_INLINE_SCENARIOS.has(scenarioId) && action.providerId === providerId
    && action.modelId === modelId
    && action.kind !== "busy"
    && action.kind !== "error"
  ));

  return (
    <div className={`flex items-center ${compact ? "flex-nowrap gap-1" : "flex-wrap gap-2"} ${align === "start" ? "justify-start" : "justify-end"}`}>
      {!compact && <span className="text-xs text-[var(--app-muted)]"><UiText id="admin.maa330a7323e5" /></span>}
      {scenarios.filter(scenario => !HIDDEN_INLINE_SCENARIOS.has(scenario.id)).map((scenario) => {
        const displayLabel = label(INLINE_LLM_SCENARIO_LABELS[scenario.id] || scenario.label);
        const draftBinding = draftBindings[scenario.id];
        const active = draftBinding
          ? draftBinding.providerId === providerId && draftBinding.modelId === modelId
          : isScenarioBoundToModel(scenario, providerId, modelId);
        const candidate = scenario.candidates.find((item) => (
          item.providerId === providerId && item.modelId === modelId
        ));
        const action = actionByScenario[scenario.id];
        const ownsAction = action?.providerId === providerId && action.modelId === modelId;
        const scenarioBusy = action?.kind === "busy";
        const busy = ownsAction && scenarioBusy;
        const unavailable = !allowDraftSelection && candidate?.status !== "ready";

        return (
          <button
            key={scenario.id}
            type="button"
            disabled={disabled || active || scenarioBusy || unavailable}
            onClick={() => onActivate(scenario.id, { providerId, modelId })}
            className={[
              "inline-flex items-center gap-1 rounded-md border transition disabled:cursor-not-allowed disabled:opacity-60",
              compact ? "shrink-0 whitespace-nowrap px-1.5 py-1 text-[10px] leading-4" : align === "start" ? "px-3 py-1.5 text-xs" : "px-2 py-1 text-[10px]",
              active
                ? "border-[var(--primary-bg)] bg-[var(--panel-2)] text-[var(--app-fg)]"
                : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)]",
            ].join(" ")}
            title={unavailable ? label(unavailableTitle(candidate?.status)) : displayLabel}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : active ? "✓" : null}
            {displayLabel}
          </button>
        );
      })}
      {rowActions.map(([scenarioId, action]) => action.message ? (
        <span
          key={scenarioId}
          className={action.kind === "error"
            ? "text-[10px] text-red-500"
            : action.kind === "sync_failed"
              ? "text-[10px] text-amber-600"
              : "text-[10px] text-emerald-600"}
        >
          {action.kind === "sync_failed" ? formatUiError(locale, action.message) : label(action.message)}
        </span>
      ) : null)}
    </div>
  );
}
