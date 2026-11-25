"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { UnifiedHistoryPanel, type UnifiedHistoryPanelHandle } from "@/components/history/unified-history-panel";
import { UnifiedHistoryActions } from "@/components/history/unified-history-actions";
import { MediaLibraryPanel } from "@/components/media-library/media-library-panel";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { consumePendingMediaLibraryOpen, MEDIA_LIBRARY_EVENT_CLOSE, MEDIA_LIBRARY_EVENT_OPEN, MEDIA_LIBRARY_EVENT_TOGGLE } from "@/lib/media-library-events";
import { visitStudioTool, type StudioTool } from "@/lib/studio/visited-tools";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { StudioToolTabs } from "@/components/studio/studio-tool-tabs";
import { StudioLoading, StudioToolBodyLoading } from "@/components/studio/studio-loading";

type Tool = StudioTool;


const loadImagePage = () => import("@/app/image/image-tool");
const ImagePage = dynamic(loadImagePage, { loading: () => null });
const loadVideoPage = () => import("@/app/video/video-tool");
const VideoPage = dynamic(loadVideoPage, { loading: () => null });

function normalizeTool(raw: string | null): Tool {
  if (raw === "image" || raw === "video") return raw;
  return "image";
}

const StudioMediaLibraryLayer = React.memo(function StudioMediaLibraryLayer({ ready }: { ready: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [hasOpened, setHasOpened] = React.useState(false);
  React.useEffect(() => { if (open) setHasOpened(true); }, [open]);

  React.useEffect(() => {
    const onToggle = () => setOpen((prev) => !prev);
    const onOpen = () => setOpen(true);
    const onClose = () => setOpen(false);
    window.addEventListener(MEDIA_LIBRARY_EVENT_TOGGLE, onToggle);
    window.addEventListener(MEDIA_LIBRARY_EVENT_OPEN, onOpen);
    window.addEventListener(MEDIA_LIBRARY_EVENT_CLOSE, onClose);
    return () => {
      window.removeEventListener(MEDIA_LIBRARY_EVENT_TOGGLE, onToggle);
      window.removeEventListener(MEDIA_LIBRARY_EVENT_OPEN, onOpen);
      window.removeEventListener(MEDIA_LIBRARY_EVENT_CLOSE, onClose);
    };
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    if (!consumePendingMediaLibraryOpen()) return;
    setOpen(true);
  }, [ready]);

  const close = React.useCallback(() => setOpen(false), []);

  return <MediaLibraryPanel open={open} onClose={close} keepMounted={hasOpened} />;
});

function StudioPageContent() {
  const searchParams = useSearchParams();
  const initialTool = normalizeTool(searchParams.get("tool"));
  const { user, loading: authLoading } = useAuth();
  const [resolvedTool, setResolvedTool] = React.useState<Tool>(initialTool);
  const [userId, setUserId] = React.useState("");

  // 统一的历史面板 ref 和状态
  const sharedHistoryRef = React.useRef<UnifiedHistoryPanelHandle>(null);
  const [historyFocusId, setHistoryFocusId] = React.useState<string | null>(null);
  const [historyCount, setHistoryCount] = React.useState(0);
  const [toolboxCollapsed, setToolboxCollapsed] = React.useState(false);
  const [compactLayout, setCompactLayout] = React.useState(false);
  const [compactView, setCompactView] = React.useState<"create" | "tasks">("create");
  const [visitedTools, setVisitedTools] = React.useState<Set<StudioTool>>(
    () => new Set<StudioTool>([initialTool]),
  );
  const [readyTools, setReadyTools] = React.useState<Set<StudioTool>>(() => new Set());
  const [historyReady, setHistoryReady] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 980px)");
    const syncLayout = () => {
      setCompactLayout(!query.matches);
      if (!query.matches) setToolboxCollapsed(false);
    };
    syncLayout();
    query.addEventListener("change", syncLayout);
    return () => query.removeEventListener("change", syncLayout);
  }, []);

  const focusHistory = React.useCallback((id: string | null) => {
    setHistoryFocusId(id);
    if (id) setCompactView("tasks");
  }, []);

  React.useEffect(() => {
    setUserId(user?.id ? String(user.id) : "");
  }, [user?.id]);

  React.useEffect(() => {
    const syncToolFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("tool");
      if (raw) {
        const normalized = normalizeTool(raw);
        setResolvedTool(normalized);
        try {
          localStorage.setItem("studio_last_tool_v1", normalized);
        } catch {}
        return;
      }

      let saved: Tool = "image";
      try {
        const v = localStorage.getItem("studio_last_tool_v1");
        if (v === "image" || v === "video") saved = v;
      } catch {}
      setResolvedTool(saved);
      window.history.replaceState(null, "", `/studio?tool=${saved}`);
    };

    syncToolFromUrl();
    window.addEventListener("popstate", syncToolFromUrl);
    return () => window.removeEventListener("popstate", syncToolFromUrl);
  }, []);

  React.useEffect(() => {
    if (!resolvedTool) return;
    setVisitedTools((previous) => visitStudioTool(previous, resolvedTool));
  }, [resolvedTool]);

  const activeTool = resolvedTool || "image";
  const activeToolReady = Boolean(resolvedTool && readyTools.has(resolvedTool));
  const markToolReady = React.useCallback((tool: StudioTool) => {
    setReadyTools((previous) => previous.has(tool) ? previous : new Set(previous).add(tool));
  }, []);
  const markHistoryReady = React.useCallback(() => {
    setHistoryReady(true);
  }, []);

  const onSelectTool = React.useCallback(
    (tool: Tool) => {
      setResolvedTool(tool);
      try {
        localStorage.setItem("studio_last_tool_v1", tool);
      } catch {}
      window.history.replaceState(null, "", `/studio?tool=${tool}`);
    },
    []
  );

  React.useEffect(() => {
    const onOpenTool = (event: Event) => {
      const detail = (event as CustomEvent<{ tool?: string }>)?.detail || {};
      const tool = normalizeTool(typeof detail.tool === "string" ? detail.tool : null);
      onSelectTool(tool);
    };
    window.addEventListener("studio:open-tool", onOpenTool as EventListener);
    return () => {
      window.removeEventListener("studio:open-tool", onOpenTool as EventListener);
    };
  }, [onSelectTool]);

  const studioNav = React.useMemo(() => ({ activeTool, onSelectTool }), [activeTool, onSelectTool]);

  // 传递给工具页面的统一历史面板控制器
  const sharedHistoryContext = React.useMemo(() => ({
    historyRef: sharedHistoryRef,
    historyFocusId,
    setHistoryFocusId: focusHistory,
    historyCount,
    setHistoryCount
  }), [historyFocusId, historyCount, focusHistory]);

  const historyActions = React.useMemo(
    () => (
      <UnifiedHistoryActions
        historyRef={sharedHistoryRef}
        historyCount={historyCount}
        userId={userId}
        variant="compact"
        onFocusHistoryId={(id) => {
          focusHistory(null);
          focusHistory(id);
        }}
      />
    ),
    [historyCount, focusHistory, sharedHistoryRef, userId]
  );
  return (
    <AtomicPageReveal ready={!authLoading && historyReady && Boolean(resolvedTool && readyTools.has(resolvedTool))}>
    <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-hidden p-[clamp(12px,2dvh,20px)]">
      <UiProps ids={{"aria-label":["studio.mc9139a496028"]}}><div role="group" aria-label="studio.mc9139a496028" className="grid shrink-0 grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 min-[980px]:hidden">
        {([ ["create", "创作"], ["tasks", "任务"] ] as const).map(([view, label]) => (
          <button key={view} type="button" aria-pressed={compactView === view} aria-controls={`studio-${view}-pane`} onClick={() => setCompactView(view)} className={`h-9 rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] ${compactView === view ? "bg-[var(--panel-2)] text-[var(--app-fg)]" : "text-[var(--app-muted)] hover:text-[var(--app-fg)]"}`}>
            {label}{view === "tasks" && historyCount > 0 ? ` (${historyCount})` : ""}
          </button>
        ))}
      </div></UiProps>
      <div
        className={[
          "relative min-h-0 flex-1 w-full grid grid-cols-1 items-stretch min-[980px]:[grid-template-columns:var(--studio-left-col)_minmax(420px,1fr)]",
          toolboxCollapsed ? "gap-0" : "gap-[clamp(12px,2dvh,24px)]"
        ].join(" ")}
        style={{ ["--studio-left-col" as any]: toolboxCollapsed ? "0px" : "clamp(400px,40vw,480px)" } as React.CSSProperties}
      >
        {/* 左侧：工具页面 - 条件渲染，提升性能 */}
        <div
          id="studio-create-pane"
          data-studio-tool-pending={resolvedTool && !activeToolReady ? resolvedTool : undefined}
          aria-hidden={(compactLayout ? compactView !== "create" : toolboxCollapsed) || undefined}
          className={[
            "relative min-h-0 h-full min-[980px]:block",
            compactView === "create" ? "block" : "hidden",
            toolboxCollapsed ? "overflow-hidden pointer-events-none" : "overflow-visible translate-x-0"
          ].join(" ")}
        >
          {!toolboxCollapsed ? (
            <UiProps ids={{"aria-label":["studio.me43de189ca2d"],"title":["studio.me43de189ca2d"]}}><button
              type="button"
              onClick={() => setToolboxCollapsed(true)}
              className="hidden min-[980px]:inline-flex absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 z-[60] h-6 w-6 text-[var(--app-muted)] hover:text-[var(--app-fg)] transition-colors items-center justify-center"
              aria-label="studio.me43de189ca2d"
              title="studio.me43de189ca2d"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button></UiProps>
          ) : null}

          <section className="isolate flex h-full min-h-0 flex-col overflow-visible rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]">
            <StudioToolTabs activeTool={activeTool} onSelectTool={onSelectTool} />
            <div
              className="relative min-h-0 flex-1"
              aria-busy={!activeToolReady}
              data-studio-tool-body-state={activeToolReady ? "ready" : "loading"}
            >
              {!activeToolReady ? <StudioToolBodyLoading /> : null}


              {visitedTools.has("image") ? (
                <div className={`h-full min-h-0 flex-col ${activeTool === "image" ? (activeToolReady ? "visible flex" : "invisible flex") : "hidden"}`}>
                  <ImagePage
                    studioNav={studioNav}
                    sharedHistory={sharedHistoryContext}
                    embeddedInStudioShell
                    onInitialReady={() => markToolReady("image")}
                  />
                </div>
              ) : null}
              {visitedTools.has("video") ? (
                <div className={`h-full min-h-0 flex-col ${activeTool === "video" ? (activeToolReady ? "visible flex" : "invisible flex") : "hidden"}`}>
                  <VideoPage
                    studioNav={studioNav}
                    sharedHistory={sharedHistoryContext}
                    embeddedInStudioShell
                    onInitialReady={() => markToolReady("video")}
                  />
                </div>
              ) : null}
            </div>
          </section>
        </div>
        {/* 右侧：统一的历史面板 */}
        <UiProps ids={{"aria-label":["studio.md3eff628a229"]}}><aside id="studio-tasks-pane" aria-label="studio.md3eff628a229" aria-hidden={(compactLayout && compactView !== "tasks") || undefined} className={`${compactView === "tasks" ? "flex" : "hidden"} min-[980px]:flex relative rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)] overflow-hidden flex-col min-h-0 h-full`}>
          {toolboxCollapsed ? (
            <UiProps ids={{"aria-label":["studio.m159f1051ab1d"],"title":["studio.m159f1051ab1d"]}}><button
              type="button"
              onClick={() => setToolboxCollapsed(false)}
              className="hidden min-[980px]:inline-flex absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 z-[60] h-6 w-6 text-[var(--app-muted)] hover:text-[var(--app-fg)] transition-colors items-center justify-center"
              aria-label="studio.m159f1051ab1d"
              title="studio.m159f1051ab1d"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button></UiProps>
          ) : null}
          <div className="flex-1 min-h-0">
            <UnifiedHistoryPanel
              ref={sharedHistoryRef}
              defaultType="all"
              focusId={historyFocusId}
              userId={userId}
              onItemCountChange={setHistoryCount}
              onInitialReady={markHistoryReady}
              floatingActions={historyActions}
              staticVideoPreviews
            />
          </div>
          <StudioMediaLibraryLayer ready={Boolean(resolvedTool)} />
        </aside></UiProps>
      </div>
    </div>
    </AtomicPageReveal>
  );
}

export default function StudioPage() {
  return (
    <React.Suspense fallback={<StudioLoading />}>
      <StudioPageContent />
    </React.Suspense>
  );
}
