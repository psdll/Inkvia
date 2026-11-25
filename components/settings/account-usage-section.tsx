"use client";
import { UiProps, UiText } from "@/i18n/ui";


import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { ProfileCard } from "./profile-card";
import { ModelUsagePanel } from "./model-usage-panel";
import styles from "./settings.module.css";
import activityStyles from "@/components/admin/admin-activity.module.css";

export function AccountUsageSection() {
  const { user, loading, openLoginModal } = useAuth();
  const desktopMode = useDesktopMode();
  return (
    <UiProps ids={{"aria-label":["settings.m7a2deb8a253a"]}}><section id="usage" className={`${styles.usage} ${activityStyles.scope}`} aria-label="settings.m7a2deb8a253a">
      {user ? (
        <div className="space-y-5"><ProfileCard /><ModelUsagePanel /></div>
      ) : (
        <div className={`${styles.card} p-6`}>
          <p className={styles.hint}>{loading ? <UiText id="settings.m390be37bf9cf" /> : <UiText id="settings.m27d75044423d" />}</p>
          {!loading && (
            <button type="button" className={`${styles.button} mt-4`} onClick={() => openLoginModal()}>
              {desktopMode ? <UiText id="settings.medd4000049f2" /> : <UiText id="settings.m3f95377f9e31" />}
            </button>
          )}
        </div>
      )}
    </section></UiProps>
  );
}
