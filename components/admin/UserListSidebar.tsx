"use client";

import { UiProps, UiText } from "@/i18n/ui";


import { AdminUserListLoading } from "@/components/admin/admin-loading";
import * as React from "react";
import { ArrowUpDown, Download, Loader2, PanelLeftClose, PanelLeftOpen, Search, Trash2, Upload, User as UserIcon } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { adminDisplayName } from "@/lib/admin-utils";
import {
  countUserOrderChanges,
  orderUsersByStableKeys,
  reconcileStableUserOrder,
} from "@/lib/admin-user-list-order";

export type UserListItem = {
  adminKey: string;
  userId: string;
  username: string | null;
  authUserId?: number | null;
  lastCreatedAt: string | null;
  deviceCount?: number;
  generationCount: number;
  failureRate: number;
  summary: string[];
};

type UserListSidebarProps = {
  q: string;
  setQ: (v: string) => void;
  users: UserListItem[];
  activeUser: string;
  setActiveUser: (k: string) => void;
  onRequestDelete: (item: UserListItem) => void;
  onRequestExport: (item: UserListItem) => void;
  onUserHover?: (item: UserListItem) => void;
  exportLoadingKey: string | null;
  onRequestImport: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  orderRefreshSignal?: number;
  pagination?: { page: number; hasMore: boolean; loading: boolean; error: boolean; onPage: (page: number) => void; onRetry: () => void };
};

type UserListViewport = "desktop" | "mobile";

function UserCard({
  item,
  active,
  onSelect,
  onRequestDelete,
  onRequestExport,
  onUserHover,
  isExporting,
}: {
  item: Pick<UserListItem, "username" | "userId">;
  active: boolean;
  onSelect?: () => void;
  onRequestDelete?: () => void;
  onRequestExport: () => void;
  onUserHover?: () => void;
  isExporting: boolean;
}) {
  const displayName = adminDisplayName(item);
  const Identity = onSelect ? "button" : "div";
  const hoverTimerRef = React.useRef<number | null>(null);
  const handlePointerEnter = React.useCallback(() => {
    if (!onUserHover) return;
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(onUserHover, 200);
  }, [onUserHover]);
  const handlePointerLeave = React.useCallback(() => {
    if (!hoverTimerRef.current) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);
  React.useEffect(() => () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
  }, []);

  return (
    <div
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      data-active={active ? "true" : undefined}
      className={[
        "group relative mb-2 w-full h-14 px-3 rounded-xl flex items-center transition-colors duration-150 text-left border border-[var(--border)]",
        active
          ? "border border-[var(--primary-bg)] bg-[var(--panel-2)]"
          : "hover:border-[var(--border-2)] hover:bg-[var(--panel-2)]",
      ].join(" ")}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--primary-bg)]" aria-hidden="true" />
      ) : null}
      <Identity type={onSelect ? "button" : undefined} onClick={onSelect} className="min-w-0 flex flex-1 items-center gap-2.5 pr-16 text-left">
        <div className="h-8 w-8 rounded-lg border border-[var(--border)] bg-[var(--panel-3)] text-[var(--app-muted)] flex items-center justify-center flex-shrink-0 text-[12px] font-bold">
          {item.username ? item.username.charAt(0).toUpperCase() : <UserIcon className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div title={displayName} className="truncate text-[13px] font-semibold text-[var(--app-fg)]">{displayName}</div>
        </div>
      </Identity>
      <div
        className={[
          "absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1 transition-opacity duration-150",
          active
            ? "opacity-100"
            : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        ].join(" ")}
      >
        {/* 导出按钮 */}
        <UiProps ids={{"title":["admin.m9e9229c82ea8"]}}><button
          type="button"
          onClick={onRequestExport}
          disabled={isExporting}
          title="admin.m9e9229c82ea8"
          className="h-7 w-7 rounded-md text-[var(--app-muted)] hover:bg-[var(--panel-bg)] hover:text-[var(--app-fg)] disabled:opacity-50 transition flex items-center justify-center"
        >
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button></UiProps>
        {/* 删除按钮 */}
        {onRequestDelete && <button
          type="button"
          onClick={onRequestDelete}
          className="h-7 w-7 rounded-md text-[var(--app-muted)] hover:bg-rose-600/10 hover:text-rose-500 transition flex items-center justify-center"
        >
          <Trash2 className="h-4 w-4" />
        </button>}
      </div>
    </div>
  );
}

function SearchInput({
  q,
  setQ,
  onRequestImport,
}: {
  q: string;
  setQ: (v: string) => void;
  onRequestImport: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-3">
      <div className="relative flex-1">
        <Search className="h-3.5 w-3.5 text-[var(--app-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <UiProps ids={{"placeholder":["admin.mabacc7f71e04"]}}><input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="admin.mabacc7f71e04"
          className="h-9 w-full pl-8 pr-3 rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[12px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
        /></UiProps>
      </div>
      <UiProps ids={{"title":["admin.m7095600fd54d"]}}><button
        type="button"
        onClick={onRequestImport}
        title="admin.m7095600fd54d"
        className="h-9 w-9 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:bg-blue-600 hover:text-white transition flex items-center justify-center flex-shrink-0"
      >
        <Upload className="h-3.5 w-3.5" />
      </button></UiProps>
    </div>
  );
}

export default function UserListSidebar({
  q,
  setQ,
  users,
  activeUser,
  setActiveUser,
  onRequestDelete,
  onRequestExport,
  onUserHover,
  exportLoadingKey,
  onRequestImport,
  collapsed = false,
  onToggleCollapsed = () => {},
  orderRefreshSignal = 0,
  pagination,
}: UserListSidebarProps) {
  const [orderState, setOrderState] = React.useState<{ query: string; keys: string[] }>({
    query: q,
    keys: [],
  });
  const listScrollRefs = React.useRef<Record<UserListViewport, HTMLDivElement | null>>({
    desktop: null,
    mobile: null,
  });
  const virtuosoRefs = React.useRef<Record<UserListViewport, VirtuosoHandle | null>>({
    desktop: null,
    mobile: null,
  });
  const lastOrderRefreshSignalRef = React.useRef(orderRefreshSignal);
  const [viewport, setViewport] = React.useState<UserListViewport>("desktop");
  const [interaction, setInteraction] = React.useState({
    desktop: { pointer: false, keyboard: false, atTop: true, lastActivity: 0 },
    mobile: { pointer: false, keyboard: false, atTop: true, lastActivity: 0 },
  });
  const keyboardInputRef = React.useRef(false);

  React.useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const updateViewport = () => {
      setViewport(media.matches ? "desktop" : "mobile");
      setInteraction((prev) => ({
        desktop: { ...prev.desktop, pointer: false, keyboard: false, lastActivity: Date.now() },
        mobile: { ...prev.mobile, pointer: false, keyboard: false, lastActivity: Date.now() },
      }));
    };
    const onKey = () => { keyboardInputRef.current = true; };
    const onPointer = () => { keyboardInputRef.current = false; };
    updateViewport();
    media.addEventListener("change", updateViewport);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      media.removeEventListener("change", updateViewport);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  React.useEffect(() => {
    setInteraction((prev) => ({
      ...prev,
      desktop: { pointer: false, keyboard: false, atTop: true, lastActivity: Date.now() },
    }));
  }, [collapsed]);

  const recordInteraction = (key: UserListViewport, patch: Partial<typeof interaction.desktop> = {}) => {
    setInteraction((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch, lastActivity: Date.now() },
    }));
  };
  const interactionProps = (key: UserListViewport): React.HTMLAttributes<HTMLElement> => ({
    onPointerEnter: (event) => {
      if (event.pointerType !== "touch") recordInteraction(key, { pointer: true });
    },
    onPointerLeave: () => recordInteraction(key, { pointer: false }),
    onPointerDownCapture: () => recordInteraction(key, { pointer: true, keyboard: false }),
    onPointerUpCapture: (event) => recordInteraction(key, event.pointerType === "touch" ? { pointer: false } : {}),
    onPointerCancel: () => recordInteraction(key, { pointer: false }),
    onKeyDownCapture: () => recordInteraction(key, { keyboard: true }),
    onFocusCapture: () => {
      if (keyboardInputRef.current) recordInteraction(key, { keyboard: true });
    },
    onBlurCapture: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        recordInteraction(key, { keyboard: false });
      }
    },
    onScrollCapture: (event) => recordInteraction(key, { atTop: (event.target as HTMLElement).scrollTop <= 4 }),
    onWheelCapture: () => recordInteraction(key),
  });
  const effectiveOrder = React.useMemo(
    () => (orderState.query === q ? orderState.keys : users.map((item) => item.adminKey)),
    [orderState, q, users],
  );
  const stableOrder = React.useMemo(
    () => reconcileStableUserOrder(effectiveOrder, users),
    [effectiveOrder, users],
  );
  const visibleUsers = React.useMemo(
    () => orderUsersByStableKeys(users, stableOrder),
    [stableOrder, users],
  );
  const orderChangeCount = React.useMemo(
    () => countUserOrderChanges(visibleUsers, users),
    [users, visibleUsers],
  );

  React.useEffect(() => {
    setOrderState((prev) => {
      const nextKeys = prev.query === q
        ? reconcileStableUserOrder(prev.keys, users)
        : users.map((item) => item.adminKey);
      const unchanged = prev.query === q
        && prev.keys.length === nextKeys.length
        && prev.keys.every((key, index) => key === nextKeys[index]);
      return unchanged ? prev : { query: q, keys: nextKeys };
    });
  }, [q, users]);

  const currentInteraction = interaction[viewport];
  React.useEffect(() => {
    if (!orderChangeCount || q.trim() || (collapsed && viewport === "desktop")
      || currentInteraction.pointer || currentInteraction.keyboard || !currentInteraction.atTop) return;
    const timer = window.setTimeout(() => {
      // Automatic ranking keeps the list at the top and never changes the selected user.
      setOrderState({ query: q, keys: users.map((item) => item.adminKey) });
    }, Math.max(0, 2000 - (Date.now() - currentInteraction.lastActivity)));
    return () => window.clearTimeout(timer);
  }, [collapsed, currentInteraction, orderChangeCount, q, users, viewport]);

  const applyCurrentRanking = React.useCallback(() => {
    const nextKeys = users.map((item) => item.adminKey);
    const activeIndex = users.findIndex((item) => item.adminKey === activeUser);
    setOrderState({ query: q, keys: nextKeys });
    if (activeIndex < 0) return;
    window.requestAnimationFrame(() => {
      if (users.length >= 100) {
        virtuosoRefs.current.desktop?.scrollToIndex({ index: activeIndex, align: "center" });
        virtuosoRefs.current.mobile?.scrollToIndex({ index: activeIndex, align: "center" });
        return;
      }
      listScrollRefs.current.desktop?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
      listScrollRefs.current.mobile?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
    });
  }, [activeUser, q, users]);

  React.useEffect(() => {
    if (lastOrderRefreshSignalRef.current === orderRefreshSignal) return;
    lastOrderRefreshSignalRef.current = orderRefreshSignal;
    applyCurrentRanking();
  }, [applyCurrentRanking, orderRefreshSignal]);

  const renderUserCard = React.useCallback(
    (u: UserListItem, keyPrefix: string) => (
      <UserCard
        key={`${keyPrefix}_${u.adminKey}`}
        item={u}
        active={activeUser === u.adminKey}
        onSelect={() => setActiveUser(u.adminKey)}
        onRequestDelete={() => onRequestDelete(u)}
        onRequestExport={() => onRequestExport(u)}
        onUserHover={onUserHover ? () => onUserHover(u) : undefined}
        isExporting={exportLoadingKey === u.adminKey}
      />
    ),
    [activeUser, exportLoadingKey, onRequestDelete, onRequestExport, onUserHover, setActiveUser]
  );

  const renderList = (keyPrefix: UserListViewport) => {
    if (!visibleUsers.length) {
      if (pagination?.loading) return <AdminUserListLoading />;
      return <div className="py-10 text-center text-[13px] text-[var(--app-muted)]">{pagination?.error ? <UiText id="admin.me9d0aba42e6e" /> : <UiText id="admin.mbab87f7d343f" />}</div>;
    }
    if (visibleUsers.length >= 100) {
      return (
        <Virtuoso
          ref={(handle) => {
            virtuosoRefs.current[keyPrefix] = handle;
          }}
          data={visibleUsers}
          computeItemKey={(_, user) => user.adminKey}
          style={{ height: "100%" }}
          increaseViewportBy={700}
          itemContent={(_, u) => <div className="pr-1">{renderUserCard(u, keyPrefix)}</div>}
        />
      );
    }
    return (
      <div
        ref={(node) => {
          listScrollRefs.current[keyPrefix] = node;
        }}
        className="h-full overflow-auto pr-1"
      >
        {visibleUsers.map((u) => renderUserCard(u, keyPrefix))}
      </div>
    );
  };

  const pageControls = pagination && (pagination.loading || pagination.error || pagination.hasMore || pagination.page > 1) ? <div className="flex shrink-0 items-center justify-between gap-2 pt-2 text-xs text-[var(--app-muted)]">
    <button disabled={pagination.loading || pagination.page <= 1} onClick={() => pagination.onPage(pagination.page - 1)} className="disabled:opacity-30"><UiText id="admin.mc9b9ae7a6144" /></button>
    {pagination.error ? <button onClick={pagination.onRetry}><UiText id="admin.m030fa62eb150" /></button> : <span>{pagination.loading ? <UiText id="admin.m346ff60e6c7c" /> : <UiText id="admin.m14171d3a998a" values={{v0: String(pagination.page)}} />}</span>}
    <button disabled={pagination.loading || !pagination.hasMore} onClick={() => pagination.onPage(pagination.page + 1)} className="disabled:opacity-30"><UiText id="admin.m8a8542f69648" /></button>
  </div> : null;
  const orderUpdateNotice = (
    <UiProps ids={{"title":["admin.me1ad5c87a5c9"]}}><div
      aria-live="polite"
      title="admin.me1ad5c87a5c9"
      className="mb-2.5 flex h-8 shrink-0 items-center justify-between gap-2 text-[var(--app-muted)]"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--app-muted)]">
        <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{orderChangeCount > 0 ? <UiText id="admin.ma038e2672e3c" /> : <UiText id="admin.ma6fb7dbafbea" />}</span>
      </span>
      {orderChangeCount > 0 ? <button
        type="button"
        onClick={applyCurrentRanking}
        className="shrink-0 rounded-md border border-[var(--border-2)] bg-[var(--panel-bg)] px-2 py-1 text-[11px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
      ><UiText id="admin.m7c7718d4caec" /></button> : null}
    </div></UiProps>
  );

  return (
    <>
      {collapsed ? (
        <UiProps ids={{"title":["admin.m2c994cd547cb"],"aria-label":["admin.m2c994cd547cb"]}}><button
          type="button"
          onClick={onToggleCollapsed}
          title="admin.m2c994cd547cb"
          aria-label="admin.m2c994cd547cb"
          className="hidden xl:flex fixed z-30 h-12 w-5 items-center justify-center rounded-r-xl border border-l-0 border-white/10 bg-[var(--panel-bg)] text-[var(--app-muted)] shadow-sm transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            left: "var(--admin-fixed-nav-offset, 0px)",
          }}
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button></UiProps>
      ) : (
        <>
          <aside
            {...interactionProps("desktop")}
            data-user-list-viewport="desktop"
            className="hidden xl:flex fixed z-20 rounded-2xl border border-[var(--border-2)] bg-[var(--panel-bg)]/92 p-3 shadow-sm flex-col overflow-hidden"
            style={{
              top: "calc(var(--global-notice-height, 0px) + 96px)",
              left: "calc(var(--admin-fixed-nav-offset, 0px) + var(--admin-page-pad, 2.5rem))",
              width: "var(--user-nav-width)",
              boxSizing: "border-box",
              height: "calc(100vh - 7rem)",
            }}
          >
            <SearchInput q={q} setQ={setQ} onRequestImport={onRequestImport} />
            {orderUpdateNotice}
            <div className="min-h-0 flex-1 overflow-hidden">{renderList("desktop")}</div>
            {pageControls}
          </aside>
          {/* 收起把手：贴在用户列表右边缘的缝隙处 */}
          <UiProps ids={{"title":["admin.mb4145d1ab50a"],"aria-label":["admin.mb4145d1ab50a"]}}><button
            type="button"
            onClick={onToggleCollapsed}
            title="admin.mb4145d1ab50a"
            aria-label="admin.mb4145d1ab50a"
            className="hidden xl:flex fixed z-30 h-12 w-5 items-center justify-center rounded-r-xl border border-l-0 border-white/10 bg-[var(--panel-bg)] text-[var(--app-muted)] shadow-sm transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
            style={{
              top: "50%",
              transform: "translateY(-50%)",
              left: "calc(var(--admin-fixed-nav-offset, 0px) + var(--admin-page-pad, 2.5rem) + var(--user-nav-width))",
            }}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button></UiProps>
        </>
      )}
      <aside {...interactionProps("mobile")} data-user-list-viewport="mobile" className="flex h-[80vh] flex-col overflow-hidden rounded-2xl border border-[var(--border-2)] bg-[var(--panel-bg)]/92 p-3 shadow-sm xl:hidden">
        <SearchInput q={q} setQ={setQ} onRequestImport={onRequestImport} />
        {orderUpdateNotice}
        <div className="min-h-0 flex-1 overflow-hidden">{renderList("mobile")}</div>
            {pageControls}
      </aside>
    </>
  );
}
