 "use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Image, Settings, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import BrandLogo from "@/components/ui/BrandLogo";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [isInitialized, setIsInitialized] = React.useState(false);

  React.useEffect(() => {
    if (isInitialized) return;

    try {
      const stored = localStorage.getItem("ai_studio_sidebar_collapsed");
      if (stored === "1") {
        setCollapsed(true);
      }
    } catch {}

    setIsInitialized(true);
  }, [isInitialized]);

  React.useEffect(() => {
    if (!isInitialized || !pathname) return;

    const shouldCollapse = pathname !== "/" && (
      pathname === "/studio" ||
      pathname.startsWith("/image") ||
      pathname.startsWith("/video") ||
      pathname.startsWith("/works") ||
      pathname.startsWith("/settings")
    );

    if (shouldCollapse !== collapsed) {
      setCollapsed(shouldCollapse);
      try {
        localStorage.setItem("ai_studio_sidebar_collapsed", shouldCollapse ? "1" : "0");
      } catch {}
    }
  }, [pathname, isInitialized, collapsed]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ai_studio_sidebar_collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href.startsWith("/studio")) return pathname === "/studio";
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  return (
    <aside
      className={[
        "relative h-screen border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] flex flex-col text-[var(--app-fg)] shrink-0 transition-[width] duration-200 ease-out",
        collapsed ? "w-[64px] px-2 py-6" : "w-[260px] p-4"
      ].join(" ")}
    >
      <UiProps ids={{"aria-label":["sidebar.meea954b92548","sidebar.mce1d67c2703c"]}}><button
        type="button"
        aria-label={collapsed ? "sidebar.meea954b92548" : "sidebar.mce1d67c2703c"}
        onClick={toggleCollapsed}
        className={[
          "absolute top-20 h-7 w-7 rounded-full border border-[var(--border)] bg-[var(--sidebar-bg)] shadow-sm z-20 flex items-center justify-center transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
          "right-[-14px]"
        ].join(" ")}
      >
        <span className="text-[var(--app-muted)]">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </span>
      </button></UiProps>

      <Link href="/studio" className={collapsed ? "flex items-center justify-center h-12 mb-8" : "flex items-center gap-2 px-2 h-12 mb-8"}>
        <div className={collapsed ? "h-10 w-10 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] flex items-center justify-center" : "h-8 w-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] flex items-center justify-center"}>
          <BrandLogo size={24} />
        </div>
        <span
          className={[
            "text-xl font-bold whitespace-nowrap overflow-hidden transition-all duration-200 ease-out",
            collapsed ? "w-0 opacity-0 ml-0" : "w-[160px] opacity-100 ml-0"
          ].join(" ")}
        >
          Inkvia
        </span>
      </Link>

      <nav className="space-y-3 flex-1 mt-8">
        <UiProps ids={{"label":["sidebar.m685ad5410207"]}}><NavItem
          href="/studio?tool=image"
          icon={<Sparkles className="w-[18px] h-[18px]" strokeWidth={2.5} />}
          label="sidebar.m685ad5410207"
          active={pathname === "/studio" || isActive("/image") || isActive("/video")}
          collapsed={collapsed}
          onNavigate={() => setCollapsed(true)}
        /></UiProps>
        <UiProps ids={{"label":["sidebar.m5f45bb826b16"]}}><NavItem
          href="/works"
          icon={<Image className="w-[18px] h-[18px]" strokeWidth={2.5} />}
          label="sidebar.m5f45bb826b16"
          active={isActive("/works")}
          collapsed={collapsed}
          onNavigate={() => setCollapsed(true)}
        /></UiProps>
      </nav>

      <div className="mt-auto border-t border-[var(--border)] pt-4">
        <UiProps ids={{"label":["sidebar.mdf3d58c7d84b"]}}><NavItem
          href="/settings"
          icon={<Settings className="w-[18px] h-[18px]" strokeWidth={2.5} />}
          label="sidebar.mdf3d58c7d84b"
          active={isActive("/settings")}
          collapsed={collapsed}
        /></UiProps>
        <p className={collapsed ? "hidden" : "text-xs text-[var(--app-muted)] px-4 mt-3"}>v1.0 Enterprise</p>
      </div>
    </aside>
  );
}

function NavItem({
  href,
  icon,
  label,
  active = false,
  collapsed,
  onNavigate
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={[
        "w-full flex items-center rounded-xl text-sm font-medium transition-all duration-300 h-12 relative group",
        collapsed ? "justify-center px-0" : "gap-3 px-3",
        active
          ? "bg-[var(--panel-2)] text-[var(--app-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] border border-[var(--border)]"
          : "text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
      ].join(" ")}
    >
      <span className={[
        "flex items-center justify-center shrink-0 rounded-lg transition-all",
        "h-9 w-9",
        active
          ? "bg-[var(--panel-3)] text-[var(--primary-bg)]"
          : "bg-[var(--input-bg)] text-[var(--app-muted)] group-hover:bg-[var(--panel-2)] group-hover:text-[var(--app-fg)]"
      ].join(" ")}>
        {icon}
      </span>
      <span
        className={[
          "whitespace-nowrap overflow-hidden transition-all duration-200 ease-out",
          collapsed ? "w-0 opacity-0" : "w-[140px] opacity-100"
        ].join(" ")}
      >
        {label}
      </span>
      {active && !collapsed && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--primary-bg)] shrink-0" />
      )}
    </Link>
  );
}
