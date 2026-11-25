"use client";

import { useUiLocale } from "@/i18n/ui";
import styles from "./settings.module.css";

export function LanguageSetting() {
  const { locale, text, setLanguage } = useUiLocale();

  return (
    <section className={styles.section} aria-labelledby="language-heading">
      <div className={styles.sectionHeading}><h2 id="language-heading" className={styles.sectionTitle}>{text("settings.language")}</h2></div>
      <div className={styles.card}>
        <div className={styles.shortcutRow}>
          <span className={styles.rowTitle}>{text("settings.language")}</span>
          <div role="group" aria-label={text("settings.language")} className={styles.shortcutControls}>
            <button type="button" className={styles.button} aria-pressed={locale === "zh-CN"} onClick={() => setLanguage("zh-CN")}>简体中文</button>
            <button type="button" className={styles.button} aria-pressed={locale === "en"} onClick={() => setLanguage("en")}>English</button>
          </div>
        </div>
      </div>
    </section>
  );
}
