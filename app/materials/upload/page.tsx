"use client";
import { UiText } from "@/i18n/ui";


import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { settingsEntryOptions } from "@/lib/client/settings-queries";
import { MaterialUploadPanel } from "@/components/settings/material-upload-panel";
import { useDesktopMode } from "@/components/system/desktop-mode";
import styles from "@/components/settings/settings.module.css";

export default function MaterialUploadPage() {
  const { user, loading, openLoginModal } = useAuth();
  const desktopMode = useDesktopMode();
  const { data, isLoading, error, refetch } = useQuery(settingsEntryOptions(user?.id));
  return <main className={styles.page}><div className={styles.container}>
    <Link href="/materials" className={styles.link}><ArrowLeft size={14} /><UiText id="materials.m8979dbfbf5df" /></Link>
    <header className={`${styles.header} mt-6`}><div><h1 className={styles.title}><UiText id="materials.m493ee58f81f5" /></h1><p className={styles.subtitle}><UiText id="materials.m48a3c491565c" /></p></div></header>
    {loading || (user && isLoading) ? <p role="status"><UiText id="materials.md245f1b96ebe" /></p> : !user ? <button className={styles.button} onClick={() => openLoginModal()}>{desktopMode ? <UiText id="materials.medd4000049f2" /> : <UiText id="materials.md9a999a7c8e8" />}</button> : error ? <p role="alert"><UiText id="materials.mce44a82db80c" /><button onClick={() => void refetch()} className={styles.button}><UiText id="materials.mb8784c8dd563" /></button></p> : data?.canUploadMaterial ? <MaterialUploadPanel defaultCreatorName={user.username} /> : <p><UiText id="materials.m4da985e4e05b" /></p>}
  </div></main>;
}
