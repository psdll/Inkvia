"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Megaphone, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopMode } from "@/components/system/desktop-mode";

type NoticeConfig = {
  enabled: boolean;
  text: string;
  href: string;
  startAt: string;
  endAt: string;
};

const DISMISSED_STORAGE_KEY = "global_notice_dismissed_key_v1";

function normalizeNoticeKeyDate(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function buildNoticeKey(config: NoticeConfig | null) {
  return JSON.stringify({
    text: String(config?.text || "").trim(),
    href: String(config?.href || "").trim(),
    startAt: normalizeNoticeKeyDate(String(config?.startAt || "")),
    endAt: normalizeNoticeKeyDate(String(config?.endAt || "")),
  });
}

export function GlobalNoticeBanner() {
  const { loading } = useAuth();
  const desktopMode = useDesktopMode();
  return !loading && !desktopMode ? <NoticeBanner /> : null;
}

function NoticeBanner() {
  const pathname = usePathname();
  const [config, setConfig] = React.useState<NoticeConfig | null>(null);
  const [dismissedKey, setDismissedKey] = React.useState("");
  const [mounted, setMounted] = React.useState(false);
  const bannerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setMounted(true);
    setDismissedKey(window.localStorage.getItem(DISMISSED_STORAGE_KEY) || "");
  }, []);

  React.useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DISMISSED_STORAGE_KEY) return;
      setDismissedKey(event.newValue || "");
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  React.useEffect(() => {
    return () => {
      document.documentElement.style.setProperty("--global-notice-height", "0px");
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch("/api/system-notice", { cache: "no-store" }).catch(() => null);
      if (!res) return;
      const json = (await res.json().catch(() => null)) as any;
      if (cancelled) return;
      const next = json?.config || {};
      setConfig({
        enabled: Boolean(next.enabled),
        text: String(next.text || ""),
        href: String(next.href || ""),
        startAt: String(next.startAt || ""),
        endAt: String(next.endAt || ""),
      });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail?.config || {};
      setConfig({
        enabled: Boolean(detail.enabled),
        text: String(detail.text || ""),
        href: String(detail.href || ""),
        startAt: String(detail.startAt || ""),
        endAt: String(detail.endAt || ""),
      });
    };
    window.addEventListener("settings:system-notice", handle as EventListener);
    return () => window.removeEventListener("settings:system-notice", handle as EventListener);
  }, []);

  const now = Date.now();
  const noticeText = String(config?.text || "");
  const noticeHref = String(config?.href || "");
  const startAt = config?.startAt ? new Date(config.startAt).getTime() : 0;
  const endAt = config?.endAt ? new Date(config.endAt).getTime() : 0;
  const noticeKey = buildNoticeKey(config);
  const isVisible =
    Boolean(config?.enabled) &&
    Boolean(noticeText.trim()) &&
    !pathname?.startsWith("/settings") &&
    !pathname?.startsWith("/admin") &&
    (!startAt || now >= startAt) &&
    (!endAt || now <= endAt) &&
    !(dismissedKey && dismissedKey === noticeKey);

  React.useEffect(() => {
    if (!mounted || !isVisible) {
      document.documentElement.style.setProperty("--global-notice-height", "0px");
      return;
    }
    const el = bannerRef.current;
    if (!el) {
      document.documentElement.style.setProperty("--global-notice-height", "0px");
      return;
    }
    const syncHeight = () => {
      document.documentElement.style.setProperty("--global-notice-height", `${el.offsetHeight || 0}px`);
    };
    syncHeight();
    const resizeObserver = new ResizeObserver(syncHeight);
    resizeObserver.observe(el);
    window.addEventListener("resize", syncHeight);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncHeight);
    };
  }, [mounted, isVisible, pathname, config?.text, config?.href, config?.startAt, config?.endAt]);

  const content = (
    <>
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Megaphone className="h-3 w-3" />
      </span>
      <span className="line-clamp-1 text-[12px] font-medium leading-5 text-amber-900 sm:text-[13px]">{noticeText}</span>
    </>
  );

  if (!mounted || !isVisible) return null;
  return createPortal(
    <div className="pointer-events-none fixed left-0 right-0 top-0 z-[2147483000]">
      <div
        ref={bannerRef}
        className="pointer-events-auto relative border-b border-amber-300/90 bg-amber-50 px-3 py-2 sm:px-4 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-[0_1px_0_rgba(180,83,9,0.15)]"
      >
        <div className="relative z-[1] flex w-full items-center justify-center">
          <div className="min-w-0 max-w-[80vw]">
            {noticeHref ? (
              <Link href={noticeHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md px-2 py-0.5 text-center hover:bg-amber-100/80">
                {content}
              </Link>
            ) : (
              <div className="inline-flex items-center gap-2 text-center">{content}</div>
            )}
          </div>
          <UiProps ids={{"aria-label":["common.m27413c315695"],"title":["common.m27413c315695"]}}><button
            type="button"
            onClick={() => {
              setDismissedKey(noticeKey);
              window.localStorage.setItem(DISMISSED_STORAGE_KEY, noticeKey);
              document.documentElement.style.setProperty("--global-notice-height", "0px");
            }}
            className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-amber-700 transition hover:bg-amber-200 hover:text-amber-800 sm:right-4"
            aria-label="common.m27413c315695"
            title="common.m27413c315695"
          >
            <X className="h-3.5 w-3.5" />
          </button></UiProps>
        </div>
      </div>
    </div>,
    document.body
  );
}
