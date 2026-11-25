"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";
import { CheckCircle2, Database, Download, FileArchive, Files, Lock, Search, X } from "lucide-react";

export type ExportOptions = {
  includeGenerations: boolean;
  includeInputFiles: boolean;
  includePresets: boolean;
  includeMediaLibrary: boolean;
  includeMaterialAssets: boolean;
  includeAgentData: boolean;
  includeWorkspaceData: boolean;
  includeMemories: boolean;
  includeBilling: boolean;
  includeFeedback: boolean;
  includeLogs: boolean;
};

const DEFAULT_OPTIONS: ExportOptions = {
  includeGenerations: true,
  includeInputFiles: true,
  includePresets: true,
  includeMediaLibrary: true,
  includeMaterialAssets: true,
  includeAgentData: true,
  includeWorkspaceData: true,
  includeMemories: true,
  includeBilling: true,
  includeFeedback: true,
  includeLogs: false,
};

const OPTION_DEFS: Array<{ key: keyof ExportOptions; label: string; desc: string }> = [
  { key: "includeGenerations", label: "资产记录 + 结果文件", desc: "所有生成任务记录及对应的输出图片/视频文件" },
  { key: "includeInputFiles", label: "输入素材文件", desc: "用户上传的参考图片等输入素材（从任务参数中提取路径）" },
  { key: "includePresets", label: "预设提示词", desc: "用户保存的各类型预设提示词 JSON 文件" },
  { key: "includeMediaLibrary", label: "私人素材库", desc: "用户私人素材库中的图片/视频及其文件" },
  { key: "includeMaterialAssets", label: "素材资产 + 挑选记录", desc: "用户创建或挑选的素材、挑选/取消明细及下载记录，连同素材文件" },
  { key: "includeAgentData", label: "Agent 对话记录", desc: "AI 对话历史、消息记录及运行日志" },
  { key: "includeWorkspaceData", label: "工作区数据", desc: "画布、画布运行记录、数字人及提示词反推任务" },
  { key: "includeMemories", label: "用户记忆", desc: "Agent 积累的用户偏好记忆数据" },
  { key: "includeBilling", label: "消费账单", desc: "API 调用计费明细记录" },
  { key: "includeFeedback", label: "问题反馈", desc: "用户提交的反馈记录（独立导出，不需勾选操作日志）" },
  { key: "includeLogs", label: "操作日志", desc: "用户所有操作日志（数量可能很大，导出耗时可能较长）" },
];

// 导出进度阶段定义
const EXPORT_STAGES = [
  { key: "query", label: "查询数据库" },
  { key: "collect", label: "收集文件" },
  { key: "pack", label: "打包压缩" },
  { key: "download", label: "开始下载" },
] as const;

type ExportStageKey = typeof EXPORT_STAGES[number]["key"];

function formatExportLimit(bytes: number | null) {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "读取中";
  return `${(bytes / 1024 ** 3).toFixed(bytes % (1024 ** 3) === 0 ? 0 : 1)} GB`;
}

export type ExportProgressState = {
  stage: ExportStageKey;
  progress: number; // 0-100
  message: string;
};

type Props = {
  username: string | null;
  userId: string;
  registered: boolean;
  onClose: () => void;
  onExport: (opts: ExportOptions & { archiveMode: "portable" | "data" }) => void;
  progressState: ExportProgressState | null; // null = 选项视图；非null = 进度视图
};

export default function UserExportModal({ username, userId, registered, onClose, onExport, progressState }: Props) {
  const [opts, setOpts] = React.useState<ExportOptions>({ ...DEFAULT_OPTIONS, includeLogs: registered });
  const [maxExportBytes, setMaxExportBytes] = React.useState<number | null>(null);

  React.useEffect(() => {
    let active = true;
    void fetch("/api/admin/user/export")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (active && Number.isFinite(Number(data?.maxExportBytes))) {
          setMaxExportBytes(Number(data.maxExportBytes));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const toggle = (key: keyof ExportOptions) => {
    if (progressState) return;
    setOpts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ESC 关闭（仅在非进行中时）
  React.useEffect(() => {
    if (progressState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, progressState]);

  const isBusy = !!progressState;
  const isDone = progressState?.progress === 100;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={isBusy ? undefined : onClose}
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-2xl flex flex-col max-h-[90vh]">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <div className="text-[14px] font-semibold text-[var(--app-fg)]">
              {isBusy ? <UiText id="admin.me39aeaee7156" /> : <UiText id="admin.m9e9229c82ea8" />}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">
              {username ? `@${username}` : userId}
            </div>
          </div>
          {!isBusy && (
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 rounded-lg text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 进度视图 */}
        {isBusy ? (
          <div className="px-6 py-8 space-y-6">
            {/* 进度条 */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[12px]">
                <span className="text-[var(--app-fg)] font-medium">{progressState.message}</span>
                <span className="text-[var(--app-muted)]">{progressState.progress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-[var(--panel-2)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
                  style={{ width: `${progressState.progress}%` }}
                />
              </div>
            </div>

            {/* 阶段指示器 */}
            <div className="flex items-center gap-0">
              {EXPORT_STAGES.map((s, idx) => {
                const stageOrder: Record<ExportStageKey, number> = { query: 0, collect: 1, pack: 2, download: 3 };
                const currentOrder = stageOrder[progressState.stage];
                const thisOrder = stageOrder[s.key];
                const done = thisOrder < currentOrder || isDone;
                const active = thisOrder === currentOrder && !isDone;

                return (
                  <React.Fragment key={s.key}>
                    <div className="flex flex-col items-center gap-1 flex-1">
                      <div
                        className={[
                          "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all",
                          done
                            ? "bg-blue-500 text-white"
                            : active
                            ? "bg-blue-500/20 border-2 border-blue-500 text-blue-500"
                            : "bg-[var(--panel-2)] text-[var(--app-muted)]",
                        ].join(" ")}
                      >
                        {done ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                      </div>
                      <span
                        className={[
                          "text-[9px] text-center whitespace-nowrap",
                          done || active ? "text-[var(--app-fg)]" : "text-[var(--app-muted)]",
                        ].join(" ")}
                      >
                        {s.label}
                      </span>
                    </div>
                    {idx < EXPORT_STAGES.length - 1 && (
                      <div
                        className={[
                          "h-0.5 flex-1 mb-4 transition-colors",
                          done ? "bg-blue-500" : "bg-[var(--panel-2)]",
                        ].join(" ")}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {isDone && (
              <p className="text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.m532af970afe9" /></p>
            )}
          </div>
        ) : (
          /* 选项视图 */
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
              {/* 账号信息（必选，锁定） */}
              <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-blue-500/8 border border-blue-500/20">
                <Lock className="h-3.5 w-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-[var(--app-fg)]"><UiText id="admin.mbd6a5d69e294" /></div>
                  <div className="mt-0.5 text-[10px] text-[var(--app-muted)]">
                    {registered ? <UiText id="admin.mfdf6adb2993e" /> : <UiText id="admin.m8bec7862fdb6" />}
                  </div>
                </div>
                <div className="h-4 w-4 rounded border-2 border-blue-500 bg-blue-500 flex-shrink-0 flex items-center justify-center">
                  <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {OPTION_DEFS.map(({ key, label, desc }) => {
                const checked = opts[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(key)}
                    className={[
                      "w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border text-left transition",
                      checked ? "border-blue-500/20 bg-blue-500/5" : "border-transparent hover:bg-[var(--panel-2)]",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "mt-0.5 h-4 w-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition",
                        checked ? "border-blue-500 bg-blue-500" : "border-[var(--border)]",
                      ].join(" ")}
                    >
                      {checked && (
                        <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-[var(--app-fg)]">{label}</div>
                      <div className="mt-0.5 text-[10px] text-[var(--app-muted)] leading-relaxed">{desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border)]">
              <div className="min-w-0 text-[10px] leading-relaxed text-[var(--app-muted)]">
                <div><UiText id="admin.m1f857cd8f900" />{formatExportLimit(maxExportBytes)}</div>
                <div><UiText id="admin.mbfa11afb610c" /></div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 rounded-lg border border-[var(--border)] text-[13px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] transition"
                ><UiText id="admin.m2cd0f3be8738" /></button>
                <button
                  type="button"
                  onClick={() => onExport({ ...opts, archiveMode: registered ? "portable" : "data" })}
                  className="h-9 px-5 rounded-lg bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-500 transition flex items-center gap-2"
                >
                  <Download className="h-3.5 w-3.5" /><UiText id="admin.m88da633ca773" /></button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
