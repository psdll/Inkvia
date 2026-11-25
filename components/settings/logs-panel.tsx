"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { Activity, AlertCircle, CheckCircle, Info, XCircle, Trash2, RefreshCw, Filter } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { DesktopDirectoryLink } from "@/components/system/desktop-directory-link";

type LogItem = {
  id: number;
  userId: string;
  username?: string | null;
  category: string;
  action: string;
  level: string;
  message: string;
  metadata: any;
  ip: string | null;
  userAgent: string | null;
  duration: number | null;
  generationId: number | null;
  createdAt: string;
  task?: { type: string; externalProvider: string | null; model: string | null; status: string; errorMsg: string | null } | null;
};

type LogStats = {
  totalLogs: number;
  errorLogs: number;
  categoryStats: Record<string, number>;
  levelStats: Record<string, number>;
  generationTaskCount: number;
};

// 截断单元格的悬停气泡：仅当内容被省略号截断时才显示完整文本。
// 通过 portal 渲染到 body，避免被表格的 overflow 容器裁掉。
function HoverTip({ text, className }: { text: string; className?: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return; // 没截断就不弹
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 360));
    setPos({ left, top: r.top });
  };
  const hide = () => setPos(null);

  return (
    <>
      <div
        ref={ref}
        className={`truncate ${className ?? ""}`}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {text}
      </div>
      {pos &&
        createPortal(
          <div
            style={{ left: pos.left, top: pos.top - 8 }}
            className="animate-fade-in pointer-events-none fixed z-[60] -translate-y-full max-w-[340px] rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]/95 px-3 py-2 text-xs text-[var(--app-fg)] shadow-[var(--shadow-2)] backdrop-blur-sm break-words whitespace-pre-wrap"
          >
            {text}
            <span className="absolute left-5 top-full -mt-px h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-[var(--panel-bg)]" />
          </div>,
          document.body
        )}
    </>
  );
}

function desktopLogFields(log: LogItem, locale: "zh-CN" | "en") {
  const meta = log.metadata || {};
  const type = String(log.task?.type || meta.taskType || meta.type || "");
  const taskType = /image|face/i.test(type) ? "图片"
    : /video/i.test(type) ? "视频"
    : /audio|speech|voice|tts|music/i.test(type) ? "音频"
    : /text|llm/i.test(type) || meta.scenarioId || ["prompt_reverse", "agent_image_prompt", "kie_ocr"].includes(log.action) ? "文本"
    : type || "—";
  const status = String(meta.status || (log.category === "generation" ? log.task?.status : "") || "").toLowerCase();
  const ongoing = /^(pending|processing|queued|running|saving|in_progress)$/.test(status)
    || (!status && (log.action === "task_create" || /^(pending|processing|queued|running)$/.test(log.task?.status || "")));
  const level = log.level === "error" || status === "failed" ? "error"
    : ongoing ? "info" : log.level === "success" || status === "success" ? "success" : log.level;
  const statusLabel = level === "error" ? "失败" : ongoing ? "进行中" : level === "success" ? "成功" : level === "warning" ? "警告" : "信息";
  const provider = meta.providerId || meta.llmProviderId || meta.provider || log.task?.externalProvider;
  const model = meta.modelId || meta.model || log.task?.model || meta.providerModel;
  const duration = log.duration ?? meta.durationMs ?? meta.elapsedMs;
  const message = level === "error" ? log.task?.errorMsg || log.message : log.message;
  return { taskType, level, statusLabel, provider: typeof provider === "string" ? provider : "—",
    model: typeof model === "string" ? model : "—", duration: typeof duration === "number" ? locale === "en" ? `${duration.toLocaleString("en-US")} ms` : `${duration}ms` : "—", message };
}

export function SettingsLogsPanel({ panelRef }: { panelRef?: React.Ref<{ refresh: () => Promise<void> }> } = {}) {
  const { label: tLabel } = useUiLocale();
  const { locale: uiLocale, label: uiLabel } = useUiLocale();
  const { user, openLoginModal } = useAuth();
  const desktopMode = useDesktopMode();
  const queryClient = useQueryClient();
  const [selectedLog, setSelectedLog] = React.useState<LogItem | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);

  const [categoryFilter, setCategoryFilter] = React.useState<string>(desktopMode ? "all" : "api");
  const [levelFilter, setLevelFilter] = React.useState<string>("all");
  const [pageSize, setPageSize] = React.useState<number>(50);
  const [page, setPage] = React.useState(1);

  const categoryOptions = React.useMemo(
    () => desktopMode ? [
      { value: "all", label: "全部调用" },
      { value: "api", label: "API调用" },
      { value: "generation", label: "生成任务" },
    ] : [
      { value: "all", label: "全部分类" },
      { value: "user_action", label: "用户行为" },
      { value: "generation", label: "生成任务" },
      { value: "api", label: "API调用" },
      { value: "system", label: "系统" },
    ],
    [desktopMode]
  );

  const levelOptions = React.useMemo(
    () => [
      { value: "all", label: "全部级别" },
      { value: "success", label: "成功" },
      { value: "info", label: "信息" },
      { value: "warning", label: "警告" },
      { value: "error", label: "错误" },
    ],
    []
  );

  const pageSizeOptions = React.useMemo(
    () => [
      { value: "20", label: "每页 20 条" },
      { value: "50", label: "每页 50 条" },
      { value: "100", label: "每页 100 条" },
      { value: "200", label: "每页 200 条" },
    ],
    []
  );

  const logQueryKey = React.useMemo(() => ["settings", user?.id, "logs", ...(desktopMode ? ["desktop-api"] : [])], [desktopMode, user?.id]);
  const logsQuery = useQuery({
    queryKey: [...logQueryKey, "list", { categoryFilter, levelFilter, page, pageSize }],
    enabled: Boolean(user?.id && user.isAdmin),
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: String(pageSize),
      });

      if (categoryFilter !== "all") {
        params.set("category", categoryFilter);
      }
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (desktopMode) params.set("view", "desktop-api");

      const res = await fetch(`/api/logs?${params}`);
      const data = await res.json();

      if (!res.ok || !data.success) throw new Error(data.error || "日志加载失败");
      return data as { data: LogItem[]; pagination: { totalPages: number } };
    },
  });
  const statsQuery = useQuery({
    queryKey: [...logQueryKey, "stats"],
    enabled: Boolean(user?.id && user.isAdmin),
    queryFn: async () => {
      const res = await fetch(desktopMode ? "/api/logs/stats?view=desktop-api" : "/api/logs/stats");
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "日志统计加载失败");
      return data.data as LogStats;
    },
  });
  const logs = logsQuery.data?.data || [];
  const totalPages = logsQuery.data?.pagination.totalPages || 1;
  const stats = statsQuery.data;
  const loading = logsQuery.isLoading;
  const refreshing = logsQuery.isFetching || statsQuery.isFetching;
  const refreshLogs = React.useCallback(() => queryClient.invalidateQueries({ queryKey: logQueryKey }), [logQueryKey, queryClient]);
  React.useImperativeHandle(panelRef, () => ({ refresh: refreshLogs }), [refreshLogs]);
  const selectedFields = desktopMode && selectedLog ? desktopLogFields(selectedLog, uiLocale) : null;

  if (!user?.id) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] p-8 text-center">
        <p className="text-sm text-[var(--app-muted)]"><UiText id="settings.m7a14f79c8416" /></p>
        <button
          type="button"
          onClick={() => openLoginModal()}
          className="mt-4 h-10 px-4 rounded-xl bg-[var(--primary-bg)] text-white text-sm hover:opacity-90 transition"
        >
          {desktopMode ? <UiText id="settings.medd4000049f2" /> : <UiText id="settings.m19e976b023c8" />}
        </button>
      </div>
    );
  }

  const handleClearLogs = async () => {
    const params = new URLSearchParams();
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (levelFilter !== "all") params.set("level", levelFilter);
    if (desktopMode) params.set("view", "desktop-api");
    const query = params.toString();
    const res = await fetch(`/api/logs${query ? `?${query}` : ""}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (data?.success) {
      setClearConfirmOpen(false);
      setSelectedLog(null);
      setPage(1);
      await refreshLogs();
    }
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "success": return <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />;
      case "info": return <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
      case "warning": return <AlertCircle className="w-4 h-4 text-amber-600 dark:text-yellow-400" />;
      case "error": return <XCircle className="w-4 h-4 text-rose-600 dark:text-red-400" />;
      default: return <Info className="w-4 h-4 text-[var(--app-muted)]" />;
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case "success": return "text-green-700 dark:text-green-400 bg-green-500/10 border-green-500/20";
      case "info": return "text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/20";
      case "warning": return "text-amber-700 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
      case "error": return "text-rose-700 dark:text-red-400 bg-red-500/10 border-red-500/20";
      default: return "text-[var(--app-muted)] bg-zinc-500/10 border-zinc-500/20";
    }
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      user_action: "用户行为",
      generation: "生成任务",
      api: "API调用",
      system: "系统",
    };
    return labels[category] || category;
  };

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-[var(--app-muted)]"><UiText id="settings.m5bd9d61033bf" /></p>
                <p className="text-2xl font-semibold text-[var(--app-fg)]">{stats.totalLogs}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <XCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-xs text-[var(--app-muted)]"><UiText id="settings.mc28d335939aa" /></p>
                <p className="text-2xl font-semibold text-[var(--app-fg)]">{stats.errorLogs}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-xs text-[var(--app-muted)]"><UiText id="settings.m264bc35f4689" /></p>
                <p className="text-2xl font-semibold text-[var(--app-fg)]">
                  {stats.generationTaskCount ?? stats.categoryStats.generation ?? 0}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Info className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-[var(--app-muted)]">{desktopMode ? <UiText id="settings.mb5476fadde65" /> : <UiText id="settings.mf8d949ddd826" />}</p>
                <p className="text-2xl font-semibold text-[var(--app-fg)]">{stats.categoryStats[desktopMode ? "api" : "user_action"] || 0}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-[var(--app-muted)]">
            <Filter className="w-4 h-4" />
            <span><UiText id="settings.m45d50a18dc43" /></span>
          </div>

          <FrostedSelect
            value={categoryFilter}
            onChange={(value) => { setCategoryFilter(value); setPage(1); }}
            options={categoryOptions.map(option => ({ ...option, label: uiLabel(option.label) }))}
            ariaLabel={tLabel("日志分类筛选")}
            showLeading={false}
            compact
            side="bottom"
            className="min-w-[102px]"
          />

          <FrostedSelect
            value={levelFilter}
            onChange={(value) => { setLevelFilter(value); setPage(1); }}
            options={levelOptions.map(option => ({ ...option, label: uiLabel(option.label) }))}
            ariaLabel={tLabel("日志级别筛选")}
            showLeading={false}
            compact
            side="bottom"
            className="min-w-[102px]"
          />

          <FrostedSelect
            value={String(pageSize)}
            onChange={(value) => { setPageSize(Number(value) || 50); setPage(1); }}
            options={pageSizeOptions.map(option => ({ ...option, label: uiLabel(option.label) }))}
            ariaLabel={tLabel("日志分页大小")}
            showLeading={false}
            compact
            side="bottom"
            className="min-w-[120px]"
          />

          <div className="ml-auto flex gap-2">
            <button
              onClick={() => void refreshLogs()}
              disabled={refreshing}
              className="h-9 px-4 rounded-xl bg-[var(--panel-2)] border border-[var(--border)] text-sm text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /><UiText id="settings.maee887434131" /></button>
            <button
              type="button"
              onClick={() => setClearConfirmOpen(true)}
              className="h-9 px-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-700 hover:bg-rose-500/15 transition flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /><UiText id="settings.mcca50ac5654e" /></button>
            {desktopMode && <DesktopDirectoryLink directory="logs" />}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)]">
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--app-muted)] w-[112px]"><UiText id="settings.m8b6ff498515b" /></th>
                <th className={`text-left px-4 py-3 text-xs font-medium text-[var(--app-muted)] ${desktopMode ? "w-[112px]" : "w-[96px]"}`}>{desktopMode ? <UiText id="settings.m6320b4a8722a" /> : <UiText id="settings.m3d9d02e83d39" />}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--app-muted)] w-[92px]">{desktopMode ? <UiText id="settings.m14d614e81c9d" /> : <UiText id="settings.m515559957fd3" />}</th>
                {desktopMode && <>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--app-muted)] w-[160px]"><UiText id="settings.m910887705c7a" /></th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--app-muted)] w-[160px]"><UiText id="settings.mc98e118e0a43" /></th>
                </>}
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--app-muted)] w-[160px]"><UiText id="settings.med31fbb483ee" /></th>
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--app-muted)]">{desktopMode ? <UiText id="settings.m255e43a40239" /> : <UiText id="settings.m4da199fae933" />}</th>
                {!desktopMode && <th className="text-left px-4 py-3 text-xs font-medium text-[var(--app-muted)] w-[88px]"><UiText id="settings.m0d0e1a86b3aa" /></th>}
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--app-muted)] w-[84px]"><UiText id="settings.me77e3d58b0dc" /></th>
              </tr>
            </thead>
            <tbody>
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={desktopMode ? 8 : 7} className="px-4 py-12 text-center text-sm text-[var(--app-muted)]"><UiText id="settings.m9dc0825fba54" /></td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={desktopMode ? 8 : 7} className="px-4 py-12 text-center text-sm text-[var(--app-muted)]"><UiText id="settings.m3de679b09843" /></td>
                </tr>
              ) : (
                logs.map((log) => {
                  const fields = desktopMode ? desktopLogFields(log, uiLocale) : null;
                  const level = fields?.level ?? log.level;
                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="border-b border-[var(--border)] hover:bg-[var(--panel-2)] cursor-pointer transition"
                    >
                      <td className="px-4 py-3 text-xs text-[var(--app-muted)] whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border ${getLevelColor(level)}${fields ? " whitespace-nowrap" : ""}`}>
                          {getLevelIcon(level)}
                          {uiLabel(fields?.statusLabel ?? log.level)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--app-fg)] whitespace-nowrap">
                        {uiLabel(fields?.taskType ?? getCategoryLabel(log.category))}
                      </td>
                      {fields && <>
                        <td className="px-4 py-3 text-xs text-[var(--app-fg)]"><HoverTip text={fields.provider} /></td>
                        <td className="px-4 py-3 text-xs text-[var(--app-muted)] font-mono"><HoverTip text={fields.model} /></td>
                      </>}
                      <td className="px-4 py-3 text-xs text-[var(--app-muted)] font-mono">
                        <HoverTip text={log.action} />
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--app-fg)]">
                        <HoverTip text={fields?.message ?? log.message} />
                      </td>
                      {!desktopMode && <td className="px-4 py-3 text-xs text-[var(--app-fg)]">
                        <HoverTip text={log.username || log.userId} />
                      </td>}
                      <td className="px-4 py-3 text-xs text-[var(--app-muted)] whitespace-nowrap">
                        {fields?.duration ?? (log.duration ? `${log.duration}ms` : "-")}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="border-t border-[var(--border)] px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-[var(--app-muted)]"><UiText id="settings.m9552fe3bd366" />{page} / {totalPages}<UiText id="settings.mf3dfea7d8844" />{pageSize}<UiText id="settings.m6fb2840d568a" /></p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 px-3 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] text-xs text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition disabled:opacity-50 disabled:cursor-not-allowed"
              ><UiText id="settings.mc9b9ae7a6144" /></button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-8 px-3 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] text-xs text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition disabled:opacity-50 disabled:cursor-not-allowed"
              ><UiText id="settings.m8a8542f69648" /></button>
            </div>
          </div>
        )}
      </div>

      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[var(--overlay)]" onClick={() => setSelectedLog(null)} />
          <div className="relative w-full max-w-3xl max-h-[80vh] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] dark:bg-[#262626] shadow-[var(--shadow)] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--app-fg)]"><UiText id="settings.m77af343f1fb7" /></h2>
              <button
                onClick={() => setSelectedLog(null)}
                className="h-8 w-8 rounded-lg hover:bg-[var(--panel-2)] transition flex items-center justify-center text-[var(--app-muted)]"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-[var(--app-muted)] mb-1"><UiText id="settings.m8b6ff498515b" /></p>
                  <p className="text-sm text-[var(--app-fg)]">{new Date(selectedLog.createdAt).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN")}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--app-muted)] mb-1">{desktopMode ? <UiText id="settings.m6320b4a8722a" /> : <UiText id="settings.m3d9d02e83d39" />}</p>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border ${getLevelColor(selectedFields?.level ?? selectedLog.level)}`}>
                    {getLevelIcon(selectedFields?.level ?? selectedLog.level)}
                    {uiLabel(selectedFields?.statusLabel ?? selectedLog.level)}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-[var(--app-muted)] mb-1">{desktopMode ? <UiText id="settings.m14d614e81c9d" /> : <UiText id="settings.m515559957fd3" />}</p>
                  <p className="text-sm text-[var(--app-fg)]">{uiLabel(selectedFields?.taskType ?? getCategoryLabel(selectedLog.category))}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--app-muted)] mb-1"><UiText id="settings.med31fbb483ee" /></p>
                  <p className="text-sm text-[var(--app-fg)] font-mono">{selectedLog.action}</p>
                </div>
                {!desktopMode && <><div>
                  <p className="text-xs text-[var(--app-muted)] mb-1"><UiText id="settings.m0d0e1a86b3aa" /></p>
                  <p className="text-sm text-[var(--app-fg)] break-all">{selectedLog.username || selectedLog.userId}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--app-muted)] mb-1"><UiText id="settings.m2b8eac259301" /></p>
                  <p className="text-sm text-[var(--app-fg)] font-mono break-all">{selectedLog.userId}</p>
                </div></>}
                {(selectedFields ? selectedFields.duration !== "—" : selectedLog.duration) && (
                  <div>
                    <p className="text-xs text-[var(--app-muted)] mb-1"><UiText id="settings.me77e3d58b0dc" /></p>
                    <p className="text-sm text-[var(--app-fg)]">{selectedFields?.duration ?? `${selectedLog.duration}ms`}</p>
                  </div>
                )}
                {selectedLog.generationId && (
                  <div>
                    <p className="text-xs text-[var(--app-muted)] mb-1"><UiText id="settings.m0867ac2a4010" /></p>
                    <p className="text-sm text-[var(--app-fg)] font-mono">{selectedLog.generationId}</p>
                  </div>
                )}
                {selectedLog.ip && (
                  <div>
                    <p className="text-xs text-[var(--app-muted)] mb-1"><UiText id="settings.mffcb08523b94" /></p>
                    <p className="text-sm text-[var(--app-fg)] font-mono">{selectedLog.ip}</p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs text-[var(--app-muted)] mb-2"><UiText id="settings.m4da199fae933" /></p>
                <p className="text-sm text-[var(--app-fg)] bg-[var(--panel-2)] border border-[var(--border)] rounded-xl p-3">
                  {selectedFields?.message ?? selectedLog.message}
                </p>
              </div>

              {selectedLog.metadata && (
                <div>
                  <p className="text-xs text-[var(--app-muted)] mb-2"><UiText id="settings.mc9746defaf96" /></p>
                  <pre className="text-xs text-[var(--app-fg)] bg-[var(--panel-2)] border border-[var(--border)] rounded-xl p-4 overflow-auto">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.userAgent && (
                <div>
                  <p className="text-xs text-[var(--app-muted)] mb-2">User Agent</p>
                  <p className="text-xs text-[var(--app-muted)] bg-[var(--panel-2)] border border-[var(--border)] rounded-xl p-3 font-mono break-all">
                    {selectedLog.userAgent}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <UiProps ids={{"title":["settings.mcca50ac5654e"],"description":["settings.m8384d4467297","settings.m0146d96a253d"],"confirmText":["settings.m1ef3de06b32e"],"cancelText":["settings.m2cd0f3be8738"]}}><ConfirmDialog
        open={clearConfirmOpen}
        title="settings.mcca50ac5654e"
        description={desktopMode ? "settings.m8384d4467297" : "settings.m0146d96a253d"}
        confirmText="settings.m1ef3de06b32e"
        cancelText="settings.m2cd0f3be8738"
        danger
        onConfirm={handleClearLogs}
        onClose={() => setClearConfirmOpen(false)}
      /></UiProps>
    </div>
  );
}
