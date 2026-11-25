"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";
import { AdminLoading } from "@/components/admin/admin-loading";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { ADMIN_SESSION_EXPIRED_EVENT } from "@/lib/client/admin-session-expired";
import { DesktopRestoreLoginLink } from "@/components/auth/desktop-restore-login";
import { useDesktopMode } from "@/components/system/desktop-mode";

export function AdminSessionGate({ children, initialAuthenticated = false }: { children: React.ReactNode; initialAuthenticated?: boolean }) {
  const desktopMode = useDesktopMode();
  const [authenticated, setAuthenticated] = React.useState(initialAuthenticated);
  const [error, setError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [expired, setExpired] = React.useState(false);

  React.useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  React.useEffect(() => {
    if (initialAuthenticated) return;
    let active = true;
    setError(false);
    const handleMissingSession = () => {
      if (desktopMode) setExpired(true);
      else window.location.replace("/settings?admin=1");
    };

    void fetchJsonOnce<{ authenticated?: boolean }>("/api/admin/session")
      .then(({ ok, json: payload }) => {
        if (!active) return;
        if (payload?.authenticated === false) {
          handleMissingSession();
          return;
        }
        if (!ok) throw new Error("SESSION_UNAVAILABLE");
        if (ok && payload?.authenticated === true) {
          setAuthenticated(true);
          return;
        }
        handleMissingSession();
      })
      .catch(() => {
        if (active) setError(true);
      });

    return () => {
      active = false;
    };
  }, [attempt, desktopMode, initialAuthenticated]);

  if (expired) return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 bg-[var(--workspace-page-bg)] p-6 text-[var(--app-fg)]">
      <h1 className="text-[15px] font-semibold">{desktopMode ? <UiText id="admin.m1423cbc02574" /> : <UiText id="admin.mc7f04f12b3c8" />}</h1>
      <p role="status" className="text-sm text-[var(--app-muted)]">{desktopMode ? <UiText id="admin.m6a17bbd3c392" /> : <UiText id="admin.m5be19f2c498e" />}</p>
      {desktopMode
        ? <DesktopRestoreLoginLink className="self-start rounded-xl bg-[var(--primary-bg)] px-4 py-2 text-sm text-[var(--primary-fg)]" />
        : <a href="/settings?admin=1" className="self-start rounded-xl bg-[var(--primary-bg)] px-4 py-2 text-sm text-[var(--primary-fg)]"><UiText id="admin.m957244cdb9f2" /></a>}
    </main>
  );

  if (!authenticated && !error) return <AdminLoading />;

  if (!authenticated) return (
    <main className="flex min-h-0 flex-1 flex-col gap-6 bg-[var(--workspace-page-bg)] p-6 text-[var(--app-fg)]" aria-busy={!error}>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-5">
        <h1 className="text-[15px] font-semibold"><UiText id="admin.mf4855d2b33ae" /></h1>
        <p className="mt-2 text-[13px] text-[var(--app-muted)]" role={error ? "alert" : "status"}>
          {error ? <UiText id="admin.mbb6e783ace8e" /> : <UiText id="admin.m96320a34dd59" />}
        </p>
        {error && <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-4 py-2 text-sm"><UiText id="admin.mb8784c8dd563" /></button>}
      </div>
    </main>
  );
  return <>{children}</>;
}
