"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, Settings, FileText, ChevronDown, Image as ImageIcon } from "lucide-react";
import BrandLogo from "@/components/ui/BrandLogo";
import { useAuth } from '@/components/auth/AuthProvider'

export function TopNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const { user, logout, openLoginModal } = useAuth()
  const menuRef = React.useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

  const quickLinks = [
    { href: "/studio?tool=image", label: "创作", icon: <Sparkles className="w-4 h-4" /> },
    { href: "/works", label: "资产", icon: <ImageIcon className="w-4 h-4" /> },
  ];

  const isActive = (href: string) => {
    if (href.startsWith("/studio")) return pathname === "/studio" || pathname === "/image" || pathname === "/video";
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--border)] bg-[var(--panel-bg)] backdrop-blur-xl">
      <div className="flex items-center justify-between h-16 px-6">
        {/* Logo */}
        <Link href="/studio" className="flex items-center gap-2.5 group">
          <div className="h-9 w-9 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] flex items-center justify-center transition-all">
            <BrandLogo size={24} />
          </div>
          <span className="text-xl font-bold text-[var(--app-fg)] hidden sm:block">Inkvia</span>
        </Link>

        {/* 中央快捷导航 */}
        <nav className="hidden md:flex items-center gap-2">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                isActive(link.href)
                  ? "bg-[var(--panel-2)] text-[var(--app-fg)] border border-[var(--border)] shadow-[var(--shadow-2)]"
                  : "text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
              }`}
            >
              {link.icon}
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>

        {/* 右侧菜单 */}
        <div className="flex items-center gap-3">
          {/* 登录状态 */}
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--app-muted)] hidden sm:block">{user.username}</span>
              <button onClick={() => { void logout(); }} className="text-sm text-[var(--app-muted)] hover:text-red-500 transition-colors"><UiText id="sidebar.m498e1d59b4d7" /></button>
            </div>
          ) : (
            <button onClick={() => openLoginModal()} className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"><UiText id="sidebar.m1e2df9c3075a" /></button>
          )}
          {/* 用户信息/设置菜单 */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--panel-2)] border border-[var(--border)] hover:bg-[var(--panel-3)] transition-all"
            >
              <Settings className="w-4 h-4 text-[var(--app-muted)]" />
              <span className="text-sm text-[var(--app-muted)] hidden sm:block"><UiText id="sidebar.mdf3d58c7d84b" /></span>
              <ChevronDown className={`w-4 h-4 text-[var(--app-muted)] transition-transform ${menuOpen ? "rotate-180" : ""}`} />
            </button>

            {/* 下拉菜单 */}
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)] overflow-hidden animate-scale-in">
                <div className="p-2 border-b border-[var(--border)]">
                  <div className="px-3 py-2 text-xs text-[var(--app-muted)]">
                    Inkvia v1.0
                  </div>
                </div>
                <div className="p-2">
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-all"
                  >
                    <Settings className="w-4 h-4" />
                    <span><UiText id="sidebar.mdf3d58c7d84b" /></span>
                  </Link>
                  <Link
                    href="/works"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-all"
                  >
                    <ImageIcon className="w-4 h-4" />
                    <span><UiText id="sidebar.m5f45bb826b16" /></span>
                  </Link>
                  <button
                    onClick={() => {
                      // 导出日志等功能
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-all"
                  >
                    <FileText className="w-4 h-4" />
                    <span><UiText id="sidebar.me86dd4d004c1" /></span>
                  </button>
                </div>
                <div className="p-2 border-t border-[var(--border)]">
                  <div className="px-3 py-2 text-[11px] text-[var(--app-muted)]">
                    Enterprise Edition
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
