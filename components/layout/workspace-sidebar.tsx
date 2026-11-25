"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import { useQueryClient } from "@tanstack/react-query";

import { warmWorkspaceRoute } from "@/lib/client/warm-workspace-route";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  House,
  Images,
  FolderOpen,
  Sun,
  Moon,
  Layers,
  SquareDashedMousePointer,
  UserRound,
} from "lucide-react";
import styles from "./workspace-sidebar.module.css";
import { AccountMenu } from "@/components/settings/account-menu";
import { FeedbackModal } from "@/components/feedback/feedback-modal";
import { useDesktopMode } from "@/components/system/desktop-mode";
import BrandLogo from "@/components/ui/BrandLogo";
import { StudioCreationIcon } from "@/components/ui/creation-icons";
import { useAuth } from "@/components/auth/AuthProvider";

type ThemeMode = "dark" | "light";
const STORAGE_THEME = "app-theme";
const FEEDBACK_REPLY_POLL_MS = 30000;
const FEEDBACK_REPLY_SEEN_KEY_PREFIX = "feedback_reply_seen_key:";
const SIDEBAR_ITEM_FOCUS_CLASS = "outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--primary-bg)]";
const WORKSPACE_LINK_PREFETCH = false;

function resolveEffectiveTheme(value: string | null | undefined): ThemeMode {
  if (value === "dark" || value === "light") return value;
  if (value === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return "light";
}

const NAV_ITEMS = [
  {
    href: "/",
    matchPaths: ["/"],
    icon: House,
    label: "sidebar.navHome",
    description: "创作入口",
    slot: "main",
  },
  {
    href: "/studio",
    matchPaths: ["/studio", "/image", "/video"],
    icon: StudioCreationIcon,
    label: "sidebar.navCreate",
    description: "AI 创作工具",
    slot: "main",
  },
  {
    href: "/batch-workbench",
    matchPaths: ["/batch-workbench"],
    icon: Layers,
    label: "sidebar.navBatch",
    description: "批量图片生成",
    slot: "main",
  },
  {
    href: "/canvas",
    matchPaths: ["/canvas"],
    icon: SquareDashedMousePointer,
    label: "sidebar.navCanvas",
    description: "节点式创作画布",
    slot: "main",
  },
  {
    href: "/materials",
    matchPaths: ["/materials"],
    icon: FolderOpen,
    label: "sidebar.navLibrary",
    description: "挑选共享素材",
    slot: "main",
  },
  {
    href: "/works",
    matchPaths: ["/works"],
    icon: Images,
    label: "sidebar.navAssets",
    description: "查看创作历史",
    slot: "main",
  },
] as const;

export function WorkspaceSidebar() {
  const { locale, text, label: uiLabel } = useUiLocale();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const collapsed = true;
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const desktopMode = useDesktopMode();
  const [tutorialDocUrl, setTutorialDocUrl] = React.useState<string>("");
  const [theme, setTheme] = React.useState<ThemeMode>("dark");
  const [entryNotice, setEntryNotice] = React.useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [hasUnreadFeedbackReply, setHasUnreadFeedbackReply] = React.useState(false);
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const entryNoticeTimerRef = React.useRef<number | null>(null);
  const warmedWorkspaceDestinationsRef = React.useRef<Set<string>>(new Set());

  const warmWorkspaceDestination = React.useCallback((href: string) => {
    if (pathname === href) return;
    void warmWorkspaceRoute(href, user?.id ? String(user.id) : undefined, queryClient);
    if (warmedWorkspaceDestinationsRef.current.has(href)) return;
    warmedWorkspaceDestinationsRef.current.add(href);
    router.prefetch(href);
  }, [pathname, router, user?.id, queryClient]);

  React.useEffect(() => {
    if (authLoading || desktopMode) return;
    let cancelled = false;

    const load = async () => {
      const res = await fetch("/api/tutorial-doc", { cache: "no-store" }).catch(() => null);
      if (!res || !res.ok) return;
      const json = (await res.json().catch(() => null)) as any;
      if (cancelled) return;
      setTutorialDocUrl(String(json?.url || ""));
    };

    const onTutorialDocUrl = (e: Event) => {
      const ce = e as CustomEvent<{ url?: string }>;
      setTutorialDocUrl(String(ce.detail?.url || ""));
    };

    void load();
    window.addEventListener("settings:tutorial-doc-url", onTutorialDocUrl as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener("settings:tutorial-doc-url", onTutorialDocUrl as EventListener);
    };
  }, [authLoading, desktopMode]);

  React.useEffect(() => {
    return () => {
      if (entryNoticeTimerRef.current) {
        window.clearTimeout(entryNoticeTimerRef.current);
      }
    };
  }, []);

  const showEntryNotice = React.useCallback((message: string) => {
    const next = String(message || "").trim();
    if (!next) return;
    setEntryNotice(next);
    if (entryNoticeTimerRef.current) {
      window.clearTimeout(entryNoticeTimerRef.current);
    }
    entryNoticeTimerRef.current = window.setTimeout(() => {
      setEntryNotice(null);
      entryNoticeTimerRef.current = null;
    }, 1200);
  }, []);

  const openFeedback = React.useCallback(() => {
    if (user) {
      setFeedbackOpen(true);
      return;
    }
    openLoginModal(() => setFeedbackOpen(true));
  }, [openLoginModal, user]);

  const markFeedbackRepliesSeen = React.useCallback((latestReplyKey: string | null) => {
    if (!user || !latestReplyKey) return;
    try {
      localStorage.setItem(`${FEEDBACK_REPLY_SEEN_KEY_PREFIX}${user.id}`, latestReplyKey);
      window.dispatchEvent(new CustomEvent("feedback:replies-seen", { detail: { userId: user.id, latestReplyKey } }));
    } catch {}
    setHasUnreadFeedbackReply(false);
  }, [user]);

  React.useEffect(() => {
    try {
      const value = localStorage.getItem(STORAGE_THEME);
      setTheme(resolveEffectiveTheme(value));
    } catch {}
  }, []);

  React.useEffect(() => {
    const syncTheme = (next: string | undefined) => {
      if (next !== "dark" && next !== "light" && next !== "system") return;
      const effective = resolveEffectiveTheme(next);
      setTheme((prev) => (prev === effective ? prev : effective));
    };

    const onThemeChange = (e: Event) => {
      const ce = e as CustomEvent<{ theme?: string; effective?: string }>;
      syncTheme(ce.detail?.effective || ce.detail?.theme);
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_THEME) return;
      syncTheme(e.newValue ?? undefined);
    };

    window.addEventListener("settings:theme", onThemeChange as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("settings:theme", onThemeChange as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const toggleTheme = React.useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_THEME, next);
      window.dispatchEvent(new CustomEvent("settings:theme", { detail: { theme: next } }));
    } catch {}
  }, [theme]);

  React.useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  React.useEffect(() => {
    if (desktopMode || !user) {
      setHasUnreadFeedbackReply(false);
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const refreshUnreadFeedbackReplies = async () => {
      if (document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      const res = await fetch("/api/logs?action=feedback_submit&limit=60", {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
      }).catch(() => null);
      inFlight = false;
      if (!res || !res.ok || cancelled) return;
      const json = (await res.json().catch(() => null)) as any;
      const rows = Array.isArray(json?.data) ? json.data : [];
      const latest = rows
        .map((r: any) => {
          const meta = r?.metadata && typeof r.metadata === "object" ? r.metadata : null;
          const adminReply = String(meta?.adminReply || "").trim();
          if (!adminReply) return null;
          return `${Number(r?.id) || 0}:${String(meta?.repliedAt || r?.createdAt || "").trim()}`;
        })
        .filter(Boolean)[0] as string | undefined;
      if (!latest || cancelled) {
        setHasUnreadFeedbackReply(false);
        return;
      }
      let seen = "";
      try {
        seen = String(localStorage.getItem(`${FEEDBACK_REPLY_SEEN_KEY_PREFIX}${user.id}`) || "");
      } catch {}
      setHasUnreadFeedbackReply(seen !== latest);
    };

    const timer = window.setInterval(() => {
      void refreshUnreadFeedbackReplies();
    }, FEEDBACK_REPLY_POLL_MS);

    const onRepliesSeen = (event: Event) => {
      const custom = event as CustomEvent<{ userId?: string; latestReplyKey?: string }>;
      if (String(custom.detail?.userId || "") !== String(user.id)) return;
      setHasUnreadFeedbackReply(false);
    };

    void refreshUnreadFeedbackReplies();
    window.addEventListener("focus", refreshUnreadFeedbackReplies);
    document.addEventListener("visibilitychange", refreshUnreadFeedbackReplies);
    window.addEventListener("feedback:replies-seen", onRepliesSeen as EventListener);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshUnreadFeedbackReplies);
      document.removeEventListener("visibilitychange", refreshUnreadFeedbackReplies);
      window.removeEventListener("feedback:replies-seen", onRepliesSeen as EventListener);
    };
  }, [desktopMode, user]);

  const isActive = (item: (typeof NAV_ITEMS)[number]) => {
    return item.matchPaths.some(
      (p) => pathname === p || pathname?.startsWith(`${p}/`) || pathname?.startsWith(`${p}?`)
    );
  };

  const rawTutorialHref = String(tutorialDocUrl || "").trim();
  // 过滤掉 @vite/client 这种开发期注入的脏数据
  const cleanedTutorialHref = /(?:^|\/)@vite\/client(?:$|\?)/i.test(rawTutorialHref)
    ? ""
    : rawTutorialHref;
  const tutorialHref = cleanedTutorialHref;
  const mainNavItems = NAV_ITEMS.filter((item) => {
    if (item.slot !== "main") return false;
    return true;
  }) as Array<(typeof NAV_ITEMS)[number]>;

  return (
    <aside
      className={[
        "relative h-full border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] flex flex-col shrink-0 transition-all duration-300 ease-out z-40 sidebar",
        "w-[72px]",
      ].join(" ")}
    >
      {pendingHref && pendingHref !== pathname ? (
        <div role="status" className="pointer-events-none fixed right-5 top-5 z-[100] rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 text-sm text-[var(--app-fg)] shadow-[var(--shadow-2)]"><UiText id="sidebar.m6b5799d00a95" /></div>
      ) : null}
      <div className={`flex items-center ${collapsed ? "justify-center px-0" : "justify-start px-5"} h-16 shrink-0`}>
        <UiProps ids={{"title":["sidebar.m5e4ed2c85287"]}}><Link href="/" className="group" title="sidebar.m5e4ed2c85287">
          <div className="logo-fx-wrap h-10 w-10 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] flex items-center justify-center transition-all shrink-0 overflow-hidden">
            <BrandLogo size={30} />
          </div>
        </Link></UiProps>
      </div>

      <div className="mx-3 h-px bg-[var(--sidebar-border)]" />

      <UiProps ids={{"aria-label":["sidebar.md867caa50e9a"]}}><nav
        aria-label="sidebar.md867caa50e9a"
        className={`flex-1 px-3 py-4 space-y-1 overflow-y-auto ${styles.navigation}`}
      >
        {!collapsed && (
          <div className="px-3 pt-4 pb-1">
            <span className="text-[11px] font-medium text-[var(--app-muted)] opacity-60 uppercase tracking-wider"><UiText id="sidebar.m37979829426b" /></span>
          </div>
        )}
        <div className="h-3" />

        {mainNavItems.map((item) => {
          const active = pendingHref ? pendingHref === item.href : isActive(item);
          const opensInNewTab = item.href === "/canvas";
          const Icon = item.icon;
          const itemClassName = [
            "w-full flex items-center rounded-xl text-sm font-medium transition-colors duration-150 group relative",
            "flex-col gap-1.5 justify-center px-0 py-2.5",
            SIDEBAR_ITEM_FOCUS_CLASS,
            active
              ? "bg-[var(--panel-2)] text-[var(--app-fg)] border border-transparent shadow-none"
              : "border border-transparent text-[var(--nav-label)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)]",
          ].join(" ");
          const iconClassName = [
            "h-9 w-9 flex items-center justify-center shrink-0 bg-transparent transition-colors",
            active
              ? "text-[var(--nav-accent)]"
              : "text-[var(--nav-muted)] group-hover:text-[var(--app-fg)]",
          ].join(" ");

          return (
            <React.Fragment key={item.href}>
              <Link
                href={item.href}
                prefetch={WORKSPACE_LINK_PREFETCH}
                target={opensInNewTab ? "_blank" : undefined}
                rel={opensInNewTab ? "noopener noreferrer" : undefined}
                className={itemClassName}
                title={collapsed ? text(item.label) : undefined}
                aria-current={active ? "page" : undefined}
                onPointerEnter={() => warmWorkspaceDestination(item.href)}
                onFocus={() => warmWorkspaceDestination(item.href)}
                onClick={(event) => {
                  if (!opensInNewTab && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                    setPendingHref(item.href);
                  }
                }}
              >
                <div className={iconClassName}>
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </div>

                <div className="min-w-0 overflow-hidden transition-all duration-300 w-auto opacity-100">
                  <span className={locale === "en" ? "block max-w-[64px] text-[11px] leading-3 text-center whitespace-nowrap" : "block max-w-[44px] text-[11px] leading-3 text-center whitespace-normal break-all"}>{text(item.label)}</span>
                </div>
              </Link>
            </React.Fragment>
          );
        })}
      </nav></UiProps>

      <div className="shrink-0 px-3 pb-4">
        <div className="mx-0 h-px bg-[var(--sidebar-border)]" />
        <div className="mt-3 flex flex-col items-center gap-6">
          <UiProps ids={{"title":["sidebar.m94d2bd014dfd","sidebar.md31a4d6bad47"]}}><button
            type="button"
            onClick={toggleTheme}
            title={theme === "light" ? "sidebar.m94d2bd014dfd" : "sidebar.md31a4d6bad47"}
            className={[
              "h-9 w-9 rounded-lg border flex items-center justify-center transition-colors shadow-[var(--shadow-2)]",
              "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]",
            ].join(" ")}
          >
            {theme === "light" ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </button></UiProps>
          <AccountMenu
            hasUnreadFeedbackReply={hasUnreadFeedbackReply}
            onFeedback={openFeedback}
            docsHref={tutorialHref}
            onMissingDocs={() => showEntryNotice("管理员尚未配置文档链接，请在「系统设置」中填写")}
            onSettingsNavigate={() => setPendingHref(desktopMode ? "/admin" : "/settings")}
            onWarmSettings={() => warmWorkspaceDestination(desktopMode ? "/admin" : "/settings")}
          >{(toggle, open) => (
            <UiProps ids={{"title":["sidebar.mb88b8409f7e4"],"aria-label":["sidebar.mb88b8409f7e4"]}}><button
              type="button"
              onClick={toggle}
              title="sidebar.mb88b8409f7e4"
              aria-label="sidebar.mb88b8409f7e4"
              aria-expanded={open}
              aria-haspopup="dialog"
              className={[
                "flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] text-[13px] font-semibold text-[var(--app-fg)] transition-colors hover:bg-[var(--panel-3)]",
                SIDEBAR_ITEM_FOCUS_CLASS,
              ].join(" ")}
            >
              {user?.username?.[0]?.toUpperCase() || <UserRound className="h-[18px] w-[18px]" strokeWidth={1.8} />}
            </button></UiProps>
          )}</AccountMenu>
        </div>
      </div>
      {entryNotice ? (
        <div className="pointer-events-none fixed inset-0 z-[120]">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)]/92 px-4 py-2.5 text-sm text-[var(--app-fg)] shadow-[var(--shadow-2)] backdrop-blur-sm">
            {uiLabel(entryNotice)}
          </div>
        </div>
      ) : null}
      {!desktopMode && <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onRepliesSeen={markFeedbackRepliesSeen}
      />}
    </aside>
  );
}
