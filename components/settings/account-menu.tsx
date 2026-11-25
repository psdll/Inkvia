"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import Link from "next/link";
import { ArrowLeftRight, BarChart3, BookOpen, CheckCircle2, ChevronRight, LogIn, LogOut, MessageCircleQuestion, Settings } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopMode } from "@/components/system/desktop-mode";
import styles from "./account-menu.module.css";

type AccountMenuProps = {
  children: (toggle: () => void, open: boolean) => React.ReactNode;
  onFeedback: () => void;
  hasUnreadFeedbackReply?: boolean;
  docsHref: string;
  onMissingDocs: () => void;
  onSettingsNavigate: () => void;
  onWarmSettings: () => void;
};

export function AccountMenu({ children, onFeedback, hasUnreadFeedbackReply = false, docsHref, onMissingDocs, onSettingsNavigate, onWarmSettings }: AccountMenuProps) {
  const { label: uiLabel } = useUiLocale();
  const { user, loading, openLoginModal, openAccountSwitchModal, logout } = useAuth();
  const desktopMode = useDesktopMode();
  const [open, setOpen] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [copied, setCopied] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); ref.current?.querySelector("button")?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  React.useEffect(() => { setOpen(false); setNotice(""); setCopied(0); }, [user?.id]);
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(0), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const actAndClose = (action: () => void) => { setOpen(false); action(); };
  const copyId = async () => {
    if (!user) return;
    try { await navigator.clipboard.writeText(String(user.id)); setNotice(""); setCopied(value => value + 1); }
    catch { setNotice("复制失败，请重试。"); }
  };
  const leave = async () => {
    setLeaving(true); setNotice("");
    try { await logout({ reload: false }); setOpen(false); }
    catch { setNotice("退出失败，请重试。"); }
    finally { setLeaving(false); }
  };
  return <div ref={ref} className={styles.root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    {children(() => setOpen(value => !value), open)}
    {copied > 0 && <div role="status" className={styles.toast}><CheckCircle2 size={17} /><UiText id="settings.mbf0b76168eb7" /></div>}
    {open && <UiProps ids={{"aria-label":["settings.mb88b8409f7e4"]}}><div ref={panel} role="dialog" aria-label="settings.mb88b8409f7e4" tabIndex={-1} className={styles.panel}>
      {user ? <div className={styles.identity}>
        <div className={styles.avatar} aria-hidden="true">{user.username?.[0]?.toUpperCase() || "I"}</div>
        <div className={styles.account}>
          <p className={styles.name}>{user.username}</p>
          <UiProps ids={{"aria-label":["settings.mdb9e4d0ec789"]}}><button type="button" className={styles.uid} aria-label="settings.mdb9e4d0ec789" onClick={() => void copyId()}>UID：{user.id}</button></UiProps>
        </div>
      </div> : <button type="button" className={`${styles.identity} ${styles.loginIdentity}`} disabled={loading} onClick={() => actAndClose(openLoginModal)}>
        <span className={styles.avatar} aria-hidden="true">I</span>
        <span className={styles.account}>
          <span className={styles.name}>{loading ? <UiText id="settings.m390be37bf9cf" /> : <UiText id="settings.mc1f658373079" />}</span>
          <span className={styles.hint}><UiText id="settings.m7b8d2c814a3f" /></span>
        </span>
      </button>}
      <UiProps ids={{"aria-label":["settings.m61fda3606981"]}}><nav aria-label="settings.m61fda3606981" className={styles.links}>
        <Link href={desktopMode ? "/admin" : "/settings"} prefetch={false} onPointerEnter={onWarmSettings} onFocus={onWarmSettings} onClick={event => {
          setOpen(false);
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) onSettingsNavigate();
        }} className={styles.item}><Settings size={17} /><UiText id="settings.mdf3d58c7d84b" /></Link>
        <a href={desktopMode ? "/admin?view=usage" : "/settings#usage"} onClick={() => setOpen(false)} className={styles.item}><BarChart3 size={17} /><UiText id="settings.m7a2deb8a253a" /></a>
        {!loading && !desktopMode && (docsHref ? <a href={docsHref} target={/^https?:\/\//i.test(docsHref) ? "_blank" : undefined} rel="noopener noreferrer" onClick={() => setOpen(false)} className={styles.item}><BookOpen size={17} /><UiText id="settings.m8914957fc91d" /></a> : <button type="button" className={styles.item} onClick={() => actAndClose(onMissingDocs)}><BookOpen size={17} /><UiText id="settings.m8914957fc91d" /></button>)}
        {!desktopMode && <button type="button" className={styles.item} onClick={() => actAndClose(onFeedback)}><MessageCircleQuestion size={17} /><UiText id="settings.m55a2ce1324c1" />{hasUnreadFeedbackReply && <UiProps ids={{"aria-label":["settings.m0caa700d35ed"]}}><span className="h-2 w-2 rounded-full bg-rose-500" aria-label="settings.m0caa700d35ed" /></UiProps>}</button>}
      </nav></UiProps>
      {(!desktopMode || !user) && <div className={styles.session}>
        {user ? <>
          <button type="button" disabled={leaving} className={styles.item} onClick={() => actAndClose(openAccountSwitchModal)}><ArrowLeftRight size={17} /><UiText id="settings.me0351ba25410" /></button>
          <button type="button" disabled={leaving} className={`${styles.item} ${styles.logout}`} onClick={() => void leave()}><LogOut size={17} />{leaving ? <UiText id="settings.m0ae60dd37b14" /> : <UiText id="settings.m3ab8cc15939f" />}</button>
        </> : <button type="button" disabled={loading} className={styles.item} onClick={() => actAndClose(openLoginModal)}><LogIn size={17} />{desktopMode ? <UiText id="settings.medd4000049f2" /> : <UiText id="settings.me5533fd28356" />}<ChevronRight size={14} className={styles.arrow} /></button>}
      </div>}
      {notice && <p role="alert" className={styles.error}>{uiLabel(notice)}</p>}
    </div></UiProps>}
  </div>;
}
