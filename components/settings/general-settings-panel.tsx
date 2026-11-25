"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Keyboard, RotateCcw } from "lucide-react";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { LanguageSetting } from "./language-setting";
import styles from "./settings.module.css";

const STORAGE_HOTKEY = "settings_hotkey_generate_v1";
const DEFAULT_HOTKEY = "Ctrl+Enter";

export function GeneralSettingsPanel({ section }: { section?: "appearance" | "hotkey" | "language" } = {}) {
  const { label: uiLabel } = useUiLocale();
  const [hotkey, setHotkey] = React.useState(DEFAULT_HOTKEY);
  const [recording, setRecording] = React.useState(false);
  const [mac, setMac] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState(false);
  const editRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    try { setHotkey(localStorage.getItem(STORAGE_HOTKEY) || DEFAULT_HOTKEY); }
    catch { setError(true); setNotice("无法读取快捷键，请检查浏览器存储权限。"); }
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_HOTKEY) setHotkey(event.newValue || DEFAULT_HOTKEY);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  React.useEffect(() => {
    if (!notice || error) return;
    const timer = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(timer);
  }, [notice, error]);
  const save = React.useCallback((value: string) => {
    try {
      localStorage.setItem(STORAGE_HOTKEY, value);
      setHotkey(value); setRecording(false); setError(false); setNotice("已保存");
      window.dispatchEvent(new CustomEvent("settings:hotkey", { detail: { hotkey: value } }));
      editRef.current?.focus();
    } catch { setError(true); setNotice("保存失败，原快捷键已保留。"); }
  }, []);
  React.useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") { setRecording(false); setNotice(""); setError(false); editRef.current?.focus(); return; }
      if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      if (event.isComposing || !event.code || (!event.ctrlKey && !event.metaKey && !event.altKey)) {
        setError(true); setNotice("请使用 Ctrl、⌘ 或 Alt 搭配其他按键。"); return;
      }
      if (((event.ctrlKey || event.metaKey) && ["R", "W", "T", "N", "L", "Q", "P", "S", "F", "A", "C", "V", "X", "Z", "Y", "H", "J", "K", "O", "B", "D", "E", "G", "U", "I", "Tab", "Space", "ArrowLeft", "ArrowRight", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].includes(key)) || /^F\d+$/.test(key) || (event.altKey && ["ArrowLeft", "ArrowRight", "Tab", " "].includes(key))) {
        setError(true); setNotice("这个组合键可能与浏览器或常用操作冲突，请换一个。"); return;
      }
      save([event.ctrlKey && "Ctrl", event.metaKey && "Meta", event.altKey && "Alt", event.shiftKey && "Shift", key === " " ? "Space" : key].filter(Boolean).join("+"));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, save]);
  const labels: Record<string, string> = mac ? { Meta: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃", Space: "空格" } : { Meta: "Win", Space: "空格" };
  return <>
    {(!section || section === "appearance") && <section className={styles.section} aria-labelledby="appearance-heading">
      <div className={styles.sectionHeading}><h2 id="appearance-heading" className={styles.sectionTitle}><UiText id="settings.m86a63f23a076" /></h2></div>
      <div className={`${styles.card} ${styles.appearance}`}><ThemeSwitcher /></div>
    </section>}
    {(!section || section === "hotkey") && <section className={styles.section} aria-labelledby="shortcuts-heading">
      <div className={styles.sectionHeading}><h2 id="shortcuts-heading" className={styles.sectionTitle}><UiText id="settings.mee2638183d3e" /></h2></div>
      <div className={styles.card}>
        <div className={styles.shortcutRow}>
          <div><h3 className={styles.rowTitle}><UiText id="settings.m58e7f6537164" /></h3><p className={styles.hint}>{recording ? <UiText id="settings.me2228a82ca29" /> : <UiText id="settings.m77a7b9706f48" />}</p></div>
          <div className={styles.shortcutControls}>
            {recording ? <span className={styles.status}><Keyboard size={16} className="mr-2 inline" /><UiText id="settings.m77f17b723372" /></span> : <span className={styles.keys} aria-label={hotkey}>{hotkey.split("+").map((key, i) => <kbd key={`${key}-${i}`} className={styles.key}>{uiLabel(labels[key] || key)}</kbd>)}</span>}
            <button ref={editRef} type="button" className={styles.button} onClick={() => { setRecording(value => !value); setNotice(""); setError(false); }}>{recording ? <UiText id="settings.m2cd0f3be8738" /> : <UiText id="settings.m37090f456516" />}</button>
          </div>
        </div>
        <div className={styles.shortcutFoot}><span role="status" className={notice ? (error ? styles.error : styles.status) : ""}>{notice ? uiLabel(notice) : <UiText id="settings.mbf2e8356f168" />}</span><button type="button" className={styles.link} onClick={() => save(DEFAULT_HOTKEY)}><RotateCcw size={12} /><UiText id="settings.mba2e93e73037" /></button></div>
      </div>
    </section>}
    {(!section || section === "language") && <LanguageSetting />}
  </>;
}
