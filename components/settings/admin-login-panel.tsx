"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck, UserRound, X } from "lucide-react";
import styles from "@/components/settings/settings.module.css";

export function AdminLoginPanel({ onClose }: { onClose: () => void }) {
  const { error: uiError } = useUiLocale();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [verified, setVerified] = React.useState<boolean | null>(null);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const submitting = React.useRef(false);
  React.useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const controller = new AbortController();
    fetch("/api/admin/session", { cache: "no-store", signal: controller.signal })
      .then(res => { if (!controller.signal.aborted) setVerified(res.status === 200); })
      .catch(() => { if (!controller.signal.aborted) setVerified(false); });
    return () => { controller.abort(); element.close(); };
  }, []);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || verified || !username.trim() || !password) return;
    submitting.current = true;
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(typeof data?.error === "string" ? data.error : "登录失败，请检查账号和密码。");
        return;
      }
      setPassword("");
      setVerified(true);
      // 验证通过后直接打开后台；拦截时由原弹窗提供新标签页入口。
      const adminTab = window.open("/admin", "_blank");
      if (adminTab) {
        adminTab.opener = null;
        onClose();
      }
    } catch {
      setErr("暂时无法连接，请稍后重试。");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const enterAdmin = <a href="/admin" target="_blank" rel="noopener noreferrer" className={styles.adminSubmit} onClick={onClose}><UiText id="settings.mab0194bdb8bd" /><ArrowRight size={17} /></a>;

  return <dialog ref={dialog} className={styles.adminDialog} aria-labelledby="admin-login-title" aria-describedby="admin-login-description"
    onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || submitting.current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <UiProps ids={{"aria-label":["settings.m200bf153e965"]}}><button type="button" className={styles.adminClose} aria-label="settings.m200bf153e965" disabled={loading} onClick={onClose}><X size={19} /></button></UiProps>
    <div className={styles.adminEmblem}><ShieldCheck size={25} strokeWidth={1.6} /></div>
    <h2 id="admin-login-title" className={styles.adminTitle}><UiText id="settings.m46bfa5fea869" /></h2>
    <p id="admin-login-description" className={styles.adminDescription}><UiText id="settings.md06424279618" /></p>
    {verified !== null && <form onSubmit={event => void login(event)} className={styles.adminForm} aria-busy={loading}>
      <div hidden={verified}>
        <label htmlFor="admin-username"><UiText id="settings.m29b1e78f19e7" /></label>
        <div className={styles.adminInput}><UserRound size={17} aria-hidden="true" /><UiProps ids={{"placeholder":["settings.m3cf7778ad08d"]}}><input id="admin-username" name="username" autoComplete="username" autoFocus required disabled={loading || verified} value={username} onChange={event => setUsername(event.target.value)} placeholder="settings.m3cf7778ad08d" /></UiProps></div>
      </div>
      <div hidden={verified}>
        <label htmlFor="admin-password"><UiText id="settings.ma621ab606db2" /></label>
        <div className={styles.adminInput}><LockKeyhole size={17} aria-hidden="true" /><UiProps ids={{"placeholder":["settings.m739d1cc26c30"]}}><input id="admin-password" name="password" autoComplete="current-password" required disabled={loading || verified} type={visible ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} placeholder="settings.m739d1cc26c30" /></UiProps>
          <UiProps ids={{"aria-label":["settings.mdd1d07bd9ceb","settings.mffe21a671190"]}}><button type="button" aria-label={visible ? "settings.mdd1d07bd9ceb" : "settings.mffe21a671190"} aria-pressed={visible} disabled={loading || verified} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></UiProps>
        </div>
      </div>
      {err && <p role="alert" className={styles.adminError}>{uiError(err)}</p>}
      {verified ? enterAdmin : <button type="submit" className={styles.adminSubmit} disabled={loading || !username.trim() || !password}>{loading ? <><Loader2 size={17} className="animate-spin" /><UiText id="settings.mc725500abce1" /></> : <><UiText id="settings.m21b8cbbb5445" /><ArrowRight size={17} /></>}</button>}
    </form>}
    <p className={styles.adminFootnote}><LockKeyhole size={13} /><UiText id="settings.m1bd07f10a481" /></p>
  </dialog>;
}
