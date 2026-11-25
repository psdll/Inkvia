"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, ImageIcon, Palette, Sparkles, Video } from "lucide-react";
import BrandLogo from "@/components/ui/BrandLogo";
import { InspirationDiscoverySection, type TemplateItem } from "@/components/home/inspiration-discovery-section";
import { ScrollToTopButton } from "@/components/ui/scroll-to-top-button";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { warmWorkspaceRoute } from "@/lib/client/warm-workspace-route";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopMode } from "@/components/system/desktop-mode";

const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export default function HomePageClient({
  initialInspirationItems = [],
}: {
  initialInspirationItems?: TemplateItem[];
}) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const desktopMode = useDesktopMode();
  const [isDark, setIsDark] = React.useState<boolean | null>(null);
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const [lowPerfDevice, setLowPerfDevice] = React.useState(false);
  const [inspirationsReady, setInspirationsReady] = React.useState(false);
  const scrollRootRef = React.useRef<HTMLDivElement | null>(null);

  // 监听主题切换
  useIsoLayoutEffect(() => {
    const check = () => {
      const root = document.documentElement;
      setIsDark(root.classList.contains("dark"));
    };
    check();
    const onTheme = () => check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    window.addEventListener("settings:theme", onTheme);
    window.addEventListener("storage", onTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("settings:theme", onTheme);
      window.removeEventListener("storage", onTheme);
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const nav = navigator as Navigator & {
      hardwareConcurrency?: number;
      deviceMemory?: number;
      connection?: { saveData?: boolean };
    };
    const cpuCores = Number(nav.hardwareConcurrency || 8);
    const memoryGb = Number(nav.deviceMemory || 8);
    const saveData = Boolean(nav.connection?.saveData);
    const lowPerf = saveData || cpuCores <= 4 || memoryGb <= 4;
    setLowPerfDevice(lowPerf);

    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduceMotion(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const dark = isDark === true;
  const themeReady = isDark !== null;

  // 首页只使用中性色和全局品牌主色，避免形成独立的配色系统。
  const ctaBg = "var(--app-fg)";
  const ctaColor = "var(--workspace-page-bg)";
  const ctaShimmer = "color-mix(in srgb, var(--workspace-page-bg) 18%, transparent)";
  const heavyFxEnabled = themeReady && !reduceMotion && !lowPerfDevice;
  const designWarmedRef = React.useRef(false);
  const warmStudioDestination = React.useCallback(() => {
    router.prefetch("/studio");
    void warmWorkspaceRoute("/studio", user?.id ? String(user.id) : undefined);
  }, [router, user?.id]);
  const warmDesignDestination = React.useCallback(() => {
    void warmWorkspaceRoute("/studio?tool=image", user?.id ? String(user.id) : undefined);
    if (designWarmedRef.current) return;
    designWarmedRef.current = true;
    router.prefetch("/studio?tool=image");
    void import("@/app/image/image-tool");
  }, [router, user?.id]);

  return (
    <AtomicPageReveal ready={themeReady && (desktopMode || inspirationsReady)}>
    <div
      ref={scrollRootRef}
      className="relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto font-sora"
      style={{
        background: "var(--workspace-page-bg)",
        color: "var(--app-fg)",
        minHeight: desktopMode ? undefined : "calc(100dvh - var(--global-notice-height, 0px))",
      }}
    >
      <div className="pointer-events-none fixed inset-0"
        style={{
          opacity: heavyFxEnabled && dark ? 0.02 : 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
      {/* Hero 区域 */}
      <div className="relative z-10 flex flex-col items-center" style={{ padding: "92px 40px 62px" }}>

        {/* 完整字标 */}
        <div
          className="relative flex items-center justify-center"
          style={{
            width: "min(100%, 500px)",
            height: 112,
            marginBottom: 20,
          }}
        >
          <BrandLogo variant="wordmark" size={100} className="relative z-10" />
        </div>

        <h1 className="sr-only"><UiText id="home.m1d2e50f48549" /></h1>

        {/* 品牌功能说明 */}
        <p className="font-sora"
          style={{
            fontSize: 16, color: "var(--app-muted)", marginBottom: 72,
            fontWeight: 400, letterSpacing: "0.15px", lineHeight: 1.6,
            textAlign: "center",
          }}><UiText id="home.m6226812295b3" /></p>

        {/* CTA 按钮 */}
        <div>
          <Link
            href="/studio"
            onPointerEnter={warmStudioDestination}
            onFocus={warmStudioDestination}
            className="cta-btn font-sora relative overflow-hidden inline-flex"
            style={{
              padding: "14px 42px", borderRadius: 999,
              background: ctaBg, color: ctaColor,
              fontSize: 14, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 10,
              letterSpacing: "0", textDecoration: "none",
              boxShadow: dark
                ? "0 6px 35px color-mix(in srgb, var(--app-fg) 7%, transparent), 0 0 70px color-mix(in srgb, var(--primary-bg) 8%, transparent), inset 0 1px 0 color-mix(in srgb, var(--app-fg) 25%, transparent)"
                : "0 6px 35px color-mix(in srgb, var(--app-fg) 10%, transparent), inset 0 1px 0 color-mix(in srgb, var(--workspace-page-bg) 12%, transparent)",
              transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
            }}
          >
            <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 999 }}>
              <div className="absolute top-0 h-full"
                style={{
                  width: "50%",
                  background: `linear-gradient(90deg, transparent, ${ctaShimmer}, transparent)`,
                  animation: heavyFxEnabled ? "shimmer 3.5s ease infinite 1.5s" : undefined,
                }}
              />
            </div>
            <span className="relative z-10"><UiText id="home.mcfbdab86969c" /></span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="relative z-10">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* 功能标签组 */}
        <div
          className="flex flex-wrap justify-center gap-[9px]"
          style={{ marginTop: 96 }}
        >
          {[
            { icon: ImageIcon, label: "GPT-Image 2", href: "/studio?tool=image&model=gpt-image-2&aspectRatio=3%3A4&resolution=2K" },
            { icon: Clapperboard, label: "Seedance 2.0", href: "/studio?tool=video&model=doubao-seedance-2-0-260128" },
            { icon: Sparkles, label: "Nano Banana Pro", href: "/studio" },
            { icon: Palette, label: "Design", href: "/studio?tool=image" },
            { icon: Video, label: "Video", href: "/studio?tool=video" },
          ].map((tag) => (
            <Link
              key={tag.label}
              href={tag.href}
              onPointerEnter={tag.label === "Design" ? warmDesignDestination : undefined}
              onFocus={tag.label === "Design" ? warmDesignDestination : undefined}
              className="tag-pill cursor-pointer font-sora"
              style={{
                padding: "7px 17px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
                background: "var(--panel-bg)",
                border: "1px solid var(--border)",
                color: "var(--app-muted)",
                display: "flex",
                alignItems: "center",
                gap: 7,
                transition: "all 0.2s ease",
                textDecoration: "none",
              }}
            >
              <tag.icon size={14} strokeWidth={1.8} aria-hidden="true" />
              {tag.label}
            </Link>
          ))}
        </div>
      </div>

      {!authLoading && !desktopMode && <InspirationDiscoverySection initialItems={initialInspirationItems} onInitialReady={() => setInspirationsReady(true)} />}
      <ScrollToTopButton scrollContainerRef={scrollRootRef} />
    </div>
    </AtomicPageReveal>
  );
}
