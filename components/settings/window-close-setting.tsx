"use client";
import { UiText, UiProps } from "@/i18n/ui";


import { useEffect, useState } from "react";
import { useDesktopMode } from "@/components/system/desktop-mode";
import styles from "./settings.module.css";

type CloseTreatment = "background" | "exit" | "ask";
type ClosePreference = { platform: "darwin" | "win32"; value: CloseTreatment };
declare global {
  interface Window {
    inkviaWindow?: {
      getCloseSetting(): Promise<ClosePreference>;
      setCloseSetting(value: CloseTreatment): Promise<CloseTreatment>;
    };
  }
}

export function WindowCloseSetting() {
  const desktopMode = useDesktopMode();
  const [setting, setSetting] = useState<ClosePreference>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!desktopMode || !window.inkviaWindow) return;
    let disposed = false;
    void window.inkviaWindow.getCloseSetting().then(
      value => { if (!disposed) setSetting(value); },
      () => { if (!disposed) setError(true); },
    );
    return () => { disposed = true; };
  }, [desktopMode]);
  if (!desktopMode) return null;

  const update = async (value: CloseTreatment) => {
    if (!window.inkviaWindow) return;
    setSaving(true);
    setError(false);
    try {
      const next = await window.inkviaWindow.setCloseSetting(value);
      setSetting(current => current && { ...current, value: next });
    } catch { setError(true); }
    finally { setSaving(false); }
  };
  return (
    <section className={styles.section} aria-labelledby="window-close-heading">
      <div className={styles.sectionHeading}><h2 id="window-close-heading" className={styles.sectionTitle}><UiText id="settings.m966a8a7d6069" /></h2></div>
      <div className={styles.card}>
        <div className={styles.shortcutRow}>
          <UiProps ids={{"aria-label":["settings.m966a8a7d6069"]}}><div role="group" aria-label="settings.m966a8a7d6069" className={styles.shortcutControls}>
            <button type="button" className={styles.button} aria-pressed={setting?.value === "background"} disabled={!setting || saving} onClick={() => void update("background")}><UiText id="settings.m6a18f380e650" /></button>
            <button type="button" className={styles.button} aria-pressed={setting?.value === "exit"} disabled={!setting || saving} onClick={() => void update("exit")}><UiText id="settings.mcf8954315968" /></button>
            {setting?.platform === "win32" && <button type="button" className={styles.button} aria-pressed={setting.value === "ask"} disabled={saving} onClick={() => void update("ask")}><UiText id="settings.mf00ef1be4493" /></button>}
          </div></UiProps>
        </div>
        {error && <p role="alert" className={styles.error}><UiText id="settings.m9ba0d2b096ee" /></p>}
      </div>
    </section>
  );
}
