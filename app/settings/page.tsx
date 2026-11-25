"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, BarChart3, SlidersHorizontal, CheckCircle2, ShieldCheck, LogOut } from "lucide-react";
import { AccountUsageSection } from "@/components/settings/account-usage-section";
import { GeneralSettingsPanel } from "@/components/settings/general-settings-panel";
import { AdminLoginPanel } from "@/components/settings/admin-login-panel";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopMode } from "@/components/system/desktop-mode";
import styles from "@/components/settings/settings.module.css";

function AdminEntry({ onChange }: { onChange: (active: boolean) => void }) {
  const params = useSearchParams();
  const requested = params.get("admin") === "1";
  React.useEffect(() => onChange(requested), [requested, onChange]);
  return null;
}

function DesktopSettingsRedirect() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace(window.location.hash === "#usage" ? "/admin?view=usage" : "/admin");
  }, [router]);
  return null;
}

export default function SettingsPage() {
  return useDesktopMode() ? <DesktopSettingsRedirect /> : <WebSettingsPage />;
}

function WebSettingsPage() {
  const { label: uiLabel } = useUiLocale();
  const { locale } = useUiLocale();
  const { user, loading, logout, openLoginModal, openAccountSwitchModal } = useAuth();
  const [leaving, setLeaving] = React.useState(false);
  const leave = async () => {
    setLeaving(true); setNotice("");
    try { await logout({ reload: false }); }
    catch { setNotice("退出失败，请重试。"); }
    finally { setLeaving(false); }
  };
  const [activeTab, setActiveTab] = React.useState<"general" | "usage">("general");
  React.useEffect(() => {
    const sync = () => setActiveTab(window.location.hash === "#usage" ? "usage" : "general");
    sync(); window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const selectTab = (next: "general" | "usage") => {
    setActiveTab(next);
    window.history.replaceState(null, "", next === "usage" ? "/settings#usage" : "/settings");
  };
  const [admin, setAdmin] = React.useState(false);
  const closeAdmin = () => {
    setAdmin(false);
    const url = new URL(window.location.href);
    if (url.searchParams.has("admin")) {
      url.searchParams.delete("admin");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  };
  const [notice, setNotice] = React.useState("");
  const [copied, setCopied] = React.useState(0);
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(0), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  React.useEffect(() => { setCopied(0); setNotice(""); }, [user?.id]);
  const copyId = async () => {
    if (!user) return;
    setNotice("");
    try { await navigator.clipboard.writeText(String(user.id)); setCopied(value => value + 1); }
    catch { setCopied(0); setNotice("复制失败，请手动复制账号 ID。"); }
  };
  const registered = user?.createdAt ? new Date(user.createdAt) : null;
  return (
    <main className={styles.page}>
      {copied > 0 && <div role="status" className={styles.copyToast}><CheckCircle2 size={18} aria-hidden="true" /><UiText id="settings.mbf0b76168eb7" /></div>}
      <React.Suspense fallback={null}><AdminEntry onChange={setAdmin} /></React.Suspense>
      <div className={styles.container}>
          <header className={styles.header}>
            <div><h1 className={styles.title}><UiText id="settings.mdf3d58c7d84b" /></h1></div>

          </header>
          <UiProps ids={{"aria-label":["settings.m1bb1e785ad5a"]}}><section aria-label="settings.m1bb1e785ad5a">
            <div className={`${styles.card} ${styles.account}`}>
              <div className={styles.avatar} aria-hidden="true">{user?.username?.[0]?.toUpperCase() || "M"}</div>
              <div className={styles.identity}>
                <div className={styles.name}>{user?.username || (loading ? <UiText id="settings.m390be37bf9cf" /> : <UiText id="settings.mc1f658373079" />)}</div>
                {user ? <div className={styles.meta}>
                  <UiProps ids={{"aria-label":["settings.mc8aebe63b34c"]}}><button type="button" onClick={() => void copyId()} className={styles.uid} aria-label="settings.mc8aebe63b34c">UID：{user.id}</button></UiProps>
                  {registered && !Number.isNaN(registered.getTime()) && <span><UiText id="settings.mcc622fc4aafd" />{registered.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" })}</span>}
                </div> : <p className={styles.hint}>{loading ? <UiText id="settings.m5c45ee179135" /> : <UiText id="settings.m377a3f1a147c" />}</p>}
              </div>
              {!loading && <div className={styles.accountActions}>
                {user ? <>
                  <button type="button" className={styles.button} disabled={leaving} onClick={() => openAccountSwitchModal()}><ArrowLeftRight size={14} /><UiText id="settings.me0351ba25410" /></button>
                  <button type="button" className={`${styles.link} ${styles.exitAccount}`} disabled={leaving} onClick={() => void leave()}><LogOut size={14} />{leaving ? <UiText id="settings.m0ae60dd37b14" /> : <UiText id="settings.m3ab8cc15939f" />}</button>
                </> : <button type="button" className={styles.button} onClick={() => openLoginModal()}><UiText id="settings.md9a999a7c8e8" /></button>}
              </div>}
            </div>
          </section></UiProps>
          <UiProps ids={{"aria-label":["settings.mdfb699c54378"]}}><div className={styles.tabs} role="tablist" aria-label="settings.mdfb699c54378">
            {(["general", "usage"] as const).map((key, index) => <button
              key={key} id={`tab-${key}`} type="button" role="tab" aria-selected={activeTab === key}
              aria-controls={`panel-${key}`} tabIndex={activeTab === key ? 0 : -1}
              onClick={() => selectTab(key)}
              onKeyDown={event => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? "general" : event.key === "End" ? "usage" : index === 0 ? "usage" : "general";
                selectTab(next); document.getElementById(`tab-${next}`)?.focus();
              }}
              className={styles.tab}
            >{key === "general" ? <SlidersHorizontal size={16} /> : <BarChart3 size={16} />}{key === "general" ? <UiText id="settings.m18a9d61deeb3" /> : <UiText id="settings.m7a2deb8a253a" />}</button>)}
          </div></UiProps>
          <div id="panel-general" role="tabpanel" aria-labelledby="tab-general" hidden={activeTab !== "general"} tabIndex={0}>
            {activeTab === "general" && <div className={styles.preferences}><GeneralSettingsPanel /></div>}
          </div>
          <div id="panel-usage" role="tabpanel" aria-labelledby="tab-usage" hidden={activeTab !== "usage"} tabIndex={0}>
            {activeTab === "usage" && <AccountUsageSection />}
          </div>
          <footer className={styles.footer}>
            <button type="button" className={styles.link} onClick={() => setAdmin(true)}><ShieldCheck size={14} /><UiText id="settings.m8fffc04ec961" /></button>
          </footer>
          {notice && <p role="alert" className={`${styles.error} mt-3`}>{uiLabel(notice)}</p>}
      </div>
      {admin && !loading && <AdminLoginPanel onClose={closeAdmin} />}
    </main>
  );
}
