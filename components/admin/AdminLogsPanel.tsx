"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";
import { formatUiDate } from "@/i18n/format";


import * as React from "react";
import { RefreshCw, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { fmtTime } from "@/lib/admin-utils";
import { RowsSkeleton } from "@/components/ui/skeleton";
import { FrostedSelect, type FrostedSelectOption } from "@/components/ui/frosted-select";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { useDesktopMode } from "@/components/system/desktop-mode";

const LEVEL_OPTIONS: FrostedSelectOption[] = [
  { label: "全部级别", value: "" },
  { label: "信息 info", value: "info" },
  { label: "成功 success", value: "success" },
  { label: "警告 warning", value: "warning" },
  { label: "错误 error", value: "error" },
];

const SCOPE_OPTIONS: FrostedSelectOption[] = [
  { label: "管理员审计", value: "admin" },
  { label: "用户行为", value: "user" },
  { label: "全部业务日志", value: "all" },
];

type LogScope = "admin" | "user" | "all";

type LogRow = {
  id: number;
  userId: string;
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
  targetUsername?: string | null;
  actor?: string | null;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

// 操作类型 → 中文标签（只保留实际会记录的几类）
const ACTION_LABELS: Record<string, string> = {
  admin_login: "管理员登录",
  user_purge: "删除用户",
  user_data_purge: "清理数据",
  generation_hard_delete: "删除资产",
  auth_user_manage: "账号管理",
  preset_purge: "清空预设",
  preset_hard_delete: "删除用户预设",
};

function actionLabel(action: string, desktopMode: boolean) {
  if (desktopMode && action === "user_purge") return "删除账号";
  if (desktopMode && action === "preset_hard_delete") return "删除预设";
  return ACTION_LABELS[action] || action || "操作";
}

// 把若干"名称: 数量"拼成一行，自动跳过 0 / 空值
function countLine(parts: Array<[string, unknown]>) {
  const segs = parts
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${k} ${Number(v)}`);
  return segs.join(" · ");
}

// 生成通俗易懂的中文描述
function describeLog(row: LogRow, desktopMode: boolean): string {
  const m = row.metadata || {};
  const who = row.targetUsername
    ? `${row.targetUsername}(ID:${m.authUserId ?? m.userId ?? "?"})`
    : m.userId
      ? `用户 ${m.userId}`
      : "未知用户";

  if (row.action === "user_purge") {
    const detail = countLine([
      ["资产", m.deletedGenerations],
      ["文件", m.deletedFiles],
      ["账单", m.deletedUsageLedgers],
      ["产品库", m.deletedMediaLibraryItems],
      ["日志", m.deletedLogs],
    ]);
    return `${desktopMode ? "彻底删除账号" : `彻底删除用户 ${who}`}${detail ? ` — ${detail}` : ""}`;
  }
  if (row.action === "user_data_purge") {
    const r = m.result || {};
    const detail = countLine([
      ["资产", r.generations],
      ["文件", r.files],
      ["日志", r.logs],
    ]);
    return `${desktopMode ? "清理本机数据" : `清理用户数据 ${who}`}${detail ? ` — ${detail}` : ""}（账号保留）`;
  }
  if (row.action === "generation_hard_delete") {
    const detail = countLine([
      ["文件", (Number(m.deletedLocalFiles) || 0) + (Number(m.deletedOssObjects) || 0)],
    ]);
    return `删除资产 #${m.id ?? row.generationId ?? "?"}（${m.taskType || "未知类型"}）${desktopMode ? "" : `· 归属 ${who}`}${detail ? ` — ${detail}` : ""}`;
  }
  if (desktopMode && row.action === "auth_user_manage") {
    if (m.subAction === "add_whitelist") return "添加本机账号白名单";
    if (m.subAction === "remove_whitelist") return "移除本机账号白名单";
  }
  // 其它操作：直接用原始 message
  return row.message || "—";
}

const LEVEL_STYLES: Record<string, string> = {
  error: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  warning: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  success: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  info: "bg-blue-500/15 text-blue-500 border-blue-500/30",
};

function LevelBadge({ level }: { level: string }) {
  const cls = LEVEL_STYLES[level] || "bg-[var(--panel-2)] text-[var(--app-muted)] border-[var(--border)]";
  return (
    <span className={["inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium", cls].join(" ")}>
      {level || "—"}
    </span>
  );
}

export type AdminLogsPanelHandle = { refresh: () => Promise<void> };

const AdminLogsPanel = React.forwardRef<AdminLogsPanelHandle, {}>(function AdminLogsPanel(_props, ref) {
  const { locale, label: uiLabel } = useUiLocale();
  const desktopMode = useDesktopMode();
  const columns = desktopMode ? "grid-cols-[150px_70px_96px_1fr]" : "grid-cols-[150px_70px_96px_1fr_110px]";
  const toolbarButton = "h-10 px-3 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[12px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center gap-1.5 disabled:opacity-60";
  const [rows, setRows] = React.useState<LogRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  // 只在"首次加载"显示骨架屏；之后的刷新一律原地更新，不闪
  const [initialLoaded, setInitialLoaded] = React.useState(false);
  const [scope, setScope] = React.useState<LogScope>("admin");
  const [level, setLevel] = React.useState<"" | "info" | "success" | "warning" | "error">("");
  const [q, setQ] = React.useState("");
  const [qInput, setQInput] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pagination, setPagination] = React.useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scope === "admin") params.set("scope", "admin");
      if (scope === "user") params.set("category", "user_action");
      params.set("page", String(page));
      params.set("limit", "50");
      if (level) params.set("level", level);
      if (q) params.set("q", q);
      const result = await fetchJsonOnce<any>(`/api/admin/logs?${params.toString()}`).catch(() => null);
      if (!result?.ok) {
        setRows([]);
        return;
      }
      const json = result.json;
      setRows(Array.isArray(json?.data) ? json.data : []);
      if (json?.pagination) setPagination(json.pagination);
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
  }, [level, page, q, scope]);

  // 手动"刷新"：原地重拉数据，且保证旋转图标至少转一会儿，让用户明显看到点击生效（不重挂载、不闪屏）
  const doRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), new Promise((r) => setTimeout(r, 500))]);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // 顶部"刷新"通过 ref 调用
  React.useImperativeHandle(ref, () => ({ refresh: doRefresh }), [doRefresh]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // 切换筛选时回到第一页
  React.useEffect(() => {
    setPage(1);
  }, [level, q, scope]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <FrostedSelect
          value={scope}
          onChange={(value) => setScope(value as LogScope)}
          options={SCOPE_OPTIONS.map(option => ({ ...option, label: uiLabel(desktopMode && option.value === "user" ? "我的操作" : option.label) }))}
          ariaLabel={uiLabel("日志范围")}
          showLeading={false}
          side="bottom"
          className="w-[140px]"
        />
        <FrostedSelect
          value={level}
          onChange={(v) => setLevel(v as any)}
          options={LEVEL_OPTIONS.map(option => ({ ...option, label: uiLabel(option.label) }))}
          ariaLabel={uiLabel("日志级别")}
          showLeading={false}
          side="bottom"
          className="w-[128px]"
        />

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--app-muted)]" />
          <UiProps ids={{"placeholder":["admin.m29193b24fdb6","admin.mddcc1e8dd16d"]}}><input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(qInput.trim());
            }}
            placeholder={desktopMode ? "admin.m29193b24fdb6" : "admin.mddcc1e8dd16d"}
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] pl-8 pr-3 text-[12px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
          /></UiProps>
        </div>

        <button
          type="button"
          onClick={() => void doRefresh()}
          disabled={refreshing}
          className={toolbarButton}
        >
          <RefreshCw className={["h-4 w-4", refreshing ? "animate-spin" : ""].join(" ")} /><UiText id="admin.maee887434131" /></button>
        {desktopMode && <a href="/__desktop/open-logs-dir" className={toolbarButton}><UiText id="admin.m6e15bd283c30" /></a>}
      </div>
      <p className="text-[11px] leading-5 text-[var(--app-muted)]">
        {desktopMode ? <UiText id="admin.m646ecc2974fd" /> : <UiText id="admin.m17070a90342e" />}
      </p>

      {/* 列表 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] overflow-hidden">
        <div className={`grid ${columns} gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--panel-2)]/50 text-[11px] font-semibold text-[var(--app-muted)]`}>
          <div><UiText id="admin.m8b6ff498515b" /></div>
          <div><UiText id="admin.m3d9d02e83d39" /></div>
          <div><UiText id="admin.med31fbb483ee" /></div>
          <div><UiText id="admin.m979a332955c8" /></div>
          {!desktopMode && <div><UiText id="admin.me18e3f8ab246" /></div>}
        </div>

        {!initialLoaded ? (
          <div className="p-3">
            <RowsSkeleton rows={8} />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-12 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.m3de679b09843" /></div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((row) => {
              const isOpen = expanded.has(row.id);
              const description = describeLog(row, desktopMode);
              return (
                <div key={row.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(row.id)}
                    className={`grid w-full ${columns} items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-[var(--panel-2)]/40 transition`}
                  >
                    <div className="text-[var(--app-muted)] tabular-nums">{formatUiDate(locale, row.createdAt, { dateStyle: "medium", timeStyle: "short" }, () => fmtTime(row.createdAt))}</div>
                    <div><LevelBadge level={row.level} /></div>
                    <div className="truncate" title={row.action}>
                      <span className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--app-fg)]">
                        {actionLabel(row.action, desktopMode)}
                      </span>
                    </div>
                    <div className="truncate text-[var(--app-fg)]" title={description}>{description}</div>
                    {!desktopMode && <div className="truncate text-[var(--app-muted)]" title={row.actor || row.userId}>{row.actor || row.userId || "—"}</div>}
                  </button>
                  {isOpen ? (
                    <div className="px-3 pb-3 pt-1 bg-[var(--panel-2)]/30 text-[11px] text-[var(--app-muted)] space-y-1">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span><UiText id="admin.m3281c0c82bfe" />{row.id}</span>
                        <span><UiText id="admin.m12801f4da0cd" />{row.category || "—"}</span>
                        {!desktopMode && <span><UiText id="admin.m06b52adb8098" />{row.actor || row.userId || "—"}</span>}
                        {!desktopMode && row.targetUsername ? <span><UiText id="admin.mdc1b97f9e83d" />{row.targetUsername}</span> : null}
                        {row.generationId ? <span><UiText id="admin.m11905a9773cc" />{row.generationId}</span> : null}
                        {row.metadata?.deviceLabel ? <span><UiText id="admin.m283db44cbbc4" />{row.metadata.deviceLabel}</span> : null}
                        {row.metadata?.deviceId ? <span><UiText id="admin.m8c0941c39f52" />{row.metadata.deviceId}</span> : null}
                        {row.ip ? <span>IP: {row.ip}</span> : null}
                        {typeof row.duration === "number" ? <span><UiText id="admin.m6ecedc16a644" />{row.duration}ms</span> : null}
                      </div>
                      {row.action === "admin_login" && row.userAgent ? <div className="break-all">User-Agent: {row.userAgent}</div> : null}
                      {row.metadata ? (
                        <pre className="mt-1 max-h-[280px] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2 text-[11px] leading-relaxed text-[var(--app-fg)] whitespace-pre-wrap break-all">
                          {JSON.stringify(row.metadata, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-between text-[12px] text-[var(--app-muted)]">
        <span><UiText id="admin.m2428420e407f" />{pagination.total}<UiText id="admin.m37fcd76651b7" />{pagination.page} / {pagination.totalPages}<UiText id="admin.m85ca81cf6abd" /></span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="h-8 w-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] flex items-center justify-center hover:bg-[var(--panel-2)] disabled:opacity-50 transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={loading || page >= pagination.totalPages}
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            className="h-8 w-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] flex items-center justify-center hover:bg-[var(--panel-2)] disabled:opacity-50 transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
});

export default AdminLogsPanel;

export function AdminLogsPanelEntry({ panelRef, ...props }: { panelRef: React.Ref<AdminLogsPanelHandle> }) {
  return <AdminLogsPanel {...props} ref={panelRef} />;
}
