"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import styles from "@/components/settings/settings.module.css";

const THEMES = [
  { key: "light", name: "settings.theme_light", icon: Sun },
  { key: "dark", name: "settings.theme_dark", icon: Moon },
  { key: "system", name: "settings.theme_system", icon: Monitor },
] as const;
type ThemeKey = (typeof THEMES)[number]["key"];
const valid = (value: string | null): value is ThemeKey => THEMES.some(item => item.key === value);

export default function ThemeSwitcher() {
  const { text } = useUiLocale();
  const [theme, setTheme] = useState<ThemeKey>("dark");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    const sync = () => {
      try {
        const stored = localStorage.getItem("app-theme") || localStorage.getItem("settings_theme_v1") || document.documentElement.getAttribute("data-theme");
        if (valid(stored)) setTheme(stored);
      } catch { setError(true); setStatus("settings.themeUnreadable"); }
      setReady(true);
    };
    sync();
    window.addEventListener("settings:theme", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("settings:theme", sync); window.removeEventListener("storage", sync); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const effective = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.setAttribute("data-theme", effective);
      document.documentElement.classList.toggle("dark", effective === "dark");
      window.dispatchEvent(new CustomEvent("settings:theme", { detail: { theme, effective } }));
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, ready]);
  useEffect(() => {
    if (!status || error) return;
    const timer = window.setTimeout(() => setStatus(""), 2500);
    return () => window.clearTimeout(timer);
  }, [status, error]);
  const choose = (next: ThemeKey) => {
    try {
      localStorage.setItem("app-theme", next);
      localStorage.setItem("settings_theme_v1", next);
      setTheme(next); setError(false); setStatus("settings.saved");
    } catch { setError(true); setStatus("settings.themeSaveFailed"); }
  };
  return <>
    <div className="flex items-start justify-between gap-3"><div><h3 className={styles.rowTitle}><UiText id="common.m8f29293906e7" /></h3><p className={styles.hint}><UiText id="common.m62ca8eda341b" /></p></div><span role="status" className={error ? styles.error : `${styles.status} shrink-0 whitespace-nowrap`}>{status && text(status)}</span></div>
    <UiProps ids={{"aria-label":["common.m8f29293906e7"]}}><div className={styles.themes} role="group" aria-label="common.m8f29293906e7">
      {THEMES.map(({ key, name, icon: Icon }) => <button key={key} type="button" disabled={!ready} aria-pressed={theme === key} onClick={() => choose(key)} className={styles.themeOption}>
        <div className={styles.previewFrame} aria-hidden="true"><div className={`${styles.preview} ${key === "dark" ? styles.previewDark : key === "system" ? styles.previewSystem : ""}`}>
          <div className={styles.previewSidebar}><i /><i /><i /><i /></div><div className={styles.previewContent}><i /><i /><span /></div>
          {key === "system" && <div className={`${styles.systemHalf} ${styles.previewDark}`}><div className={styles.previewSidebar}><i /><i /><i /><i /></div><div className={styles.previewContent}><i /><i /><span /></div></div>}
        </div></div>
        <span className={styles.themeCaption}><span className={styles.themeLabel}><Icon size={13} />{text(name)}</span><span className={styles.radio} aria-hidden="true">{theme === key && <Check size={10} strokeWidth={3} />}</span></span>
      </button>)}
    </div></UiProps>
  </>;
}
