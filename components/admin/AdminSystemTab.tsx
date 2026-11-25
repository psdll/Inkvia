"use client";
import { UiText } from "@/i18n/ui";


import { useDesktopMode } from "@/components/system/desktop-mode";
import { DESKTOP_SYSTEM_SETTING_NAV_ENTRIES, VALID_DESKTOP_SYSTEM_SECTION_KEYS } from "@/components/admin/system-navigation";

import * as React from "react";
import { WindowCloseSetting } from "@/components/settings/window-close-setting";
import { GeneralSettingsPanel } from "@/components/settings/general-settings-panel";
import settingsStyles from "@/components/settings/settings.module.css";
import { AdminFormLoading } from "@/components/admin/admin-loading";
import dynamic from "next/dynamic";
import Link from "next/link";
import { warmAuthUsers } from "@/lib/admin/auth-users-cache";
import { AlertTriangle, Package2, Sparkles, Users } from "lucide-react";
import SystemNavSidebar from "@/components/admin/SystemNavSidebar";
import type {
  SystemNavEntry,
  SystemSectionKey,
} from "@/components/admin/system-navigation";
import BuiltinPresetsSection, {
  type BuiltinPresetsSectionHandle,
} from "@/components/admin/BuiltinPresetsSection";

function SystemSectionLoading() {
  return <AdminFormLoading />;
}

const loadUserManagement = () => import("@/components/admin/UserManagement");
const loadInspirationTemplatesPanel = () =>
  import("@/components/admin/InspirationTemplatesPanel");
const loadErrorCodeGuidePanel = () =>
  import("@/components/admin/ErrorCodeGuidePanel");
const loadTutorialDocSection = () =>
  import("@/components/admin/TutorialDocSection");
const loadSystemNoticeSection = () =>
  import("@/components/admin/SystemNoticeSection");
const loadRolePositioningSection = () =>
  import("@/components/admin/RolePositioningSection");
const loadSegmentedPromptRulePanel = () =>
  import("@/components/admin/SegmentedPromptRulePanel");
const loadAdminAliyunOssSettingsSection = () =>
  import("@/components/admin/AdminAliyunOssSettingsSection");
const loadAdminOssSection = () => import("@/components/admin/AdminOssSection");
const loadBillingPriceRulesPanel = () =>
  import("@/components/admin/BillingPriceRulesPanel");
const loadImageEditModelsPanel = () =>
  import("@/components/admin/ImageEditModelsPanel");
const loadMaterialRequestDocSection = () =>
  import("@/components/admin/MaterialRequestDocSection");
const loadMaterialCreatorInspirationPermissions = () =>
  import("@/components/admin/MaterialCreatorInspirationPermissions");
const loadProvidersPanel = () => import("@/components/admin/ProvidersPanel");

const UserManagement = dynamic(loadUserManagement, {
  loading: SystemSectionLoading,
});
const InspirationTemplatesPanel = dynamic(loadInspirationTemplatesPanel, {
  loading: SystemSectionLoading,
});
const ErrorCodeGuidePanel = dynamic(loadErrorCodeGuidePanel, {
  loading: SystemSectionLoading,
});
const TutorialDocSection = dynamic(loadTutorialDocSection, {
  loading: SystemSectionLoading,
});
const SystemNoticeSection = dynamic(loadSystemNoticeSection, {
  loading: SystemSectionLoading,
});
const RolePositioningSection = dynamic(loadRolePositioningSection, {
  loading: SystemSectionLoading,
});
const SegmentedPromptRulePanel = dynamic(loadSegmentedPromptRulePanel, {
  loading: SystemSectionLoading,
});
const AdminAliyunOssSettingsSection = dynamic(
  loadAdminAliyunOssSettingsSection,
  { loading: SystemSectionLoading },
);
const AdminMediaDeliverySection = dynamic(
  () => import("@/components/admin/AdminMediaDeliverySection"),
  { loading: SystemSectionLoading },
);
const AdminOssSection = dynamic(loadAdminOssSection, {
  loading: SystemSectionLoading,
});
const BillingPriceRulesPanel = dynamic(loadBillingPriceRulesPanel, {
  loading: SystemSectionLoading,
});
const ImageEditModelsPanel = dynamic(loadImageEditModelsPanel, {
  loading: SystemSectionLoading,
});
const MaterialRequestDocSection = dynamic(loadMaterialRequestDocSection, {
  loading: SystemSectionLoading,
});
const MaterialCreatorInspirationPermissions = dynamic(
  loadMaterialCreatorInspirationPermissions,
  { loading: SystemSectionLoading },
);
const ProvidersPanel = dynamic(loadProvidersPanel, {
  loading: SystemSectionLoading,
});

const SYSTEM_SECTION_PRELOADERS: Partial<
  Record<SystemSectionKey, () => Promise<unknown>>
> = {
  account: loadUserManagement,
  tutorial: loadTutorialDocSection,
  notice: loadSystemNoticeSection,
  product: loadAdminOssSection,
  errorGuide: loadErrorCodeGuidePanel,
  inspiration: loadInspirationTemplatesPanel,
  materialAssets: () =>
    Promise.all([
      loadMaterialRequestDocSection(),
      loadMaterialCreatorInspirationPermissions(),
    ]),
  imageEditModels: loadImageEditModelsPanel,
  billingPrices: loadBillingPriceRulesPanel,
  providers: loadProvidersPanel,
  rolePositioning: loadRolePositioningSection,
  segmentedPromptRule: loadSegmentedPromptRulePanel,
  aliyunOss: loadAdminAliyunOssSettingsSection,
};

export function preloadAdminSystemSection(section: SystemSectionKey) {
  if (section === "account") void warmAuthUsers();
  void SYSTEM_SECTION_PRELOADERS[section]?.();
}

type AdminSystemTabProps = {
  active?: boolean;
  navEntries: readonly SystemNavEntry[];
  activeSection: SystemSectionKey;
  onSelectSection: (key: SystemSectionKey) => void;
  contentScrollRef: React.RefObject<HTMLDivElement | null>;
  builtinPresetsRef: React.RefObject<BuiltinPresetsSectionHandle>;
  onRequestDeleteBuiltinPreset: (
    scope: string,
    presetId: string,
    presetName: string,
  ) => void;
  /** 顶部"刷新"信号：变化时让数据型子面板原地后台刷新，不重挂载、不白屏 */
  refreshSignal?: number;
};

const sectionClassName =
  "scroll-mt-28 rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] p-6 shadow-sm";

export default function AdminSystemTab({
  active = true,
  navEntries,
  activeSection,
  onSelectSection,
  contentScrollRef,
  builtinPresetsRef,
  onRequestDeleteBuiltinPreset,
  refreshSignal,
}: AdminSystemTabProps) {
  const desktopMode = useDesktopMode();
  const mountedSections = React.useRef<SystemSectionKey[]>([]);
  if (!mountedSections.current.includes(activeSection)) {
    mountedSections.current.push(activeSection);
  }

  const sectionRefreshSignals = React.useRef(new Map<SystemSectionKey, number | undefined>());
  const lastRefreshSignal = React.useRef(refreshSignal);
  // Consume refreshes from other tabs without reloading cached settings on return.
  if (!sectionRefreshSignals.current.has(activeSection) || (active && lastRefreshSignal.current !== refreshSignal)) {
    sectionRefreshSignals.current.set(activeSection, refreshSignal);
  }
  lastRefreshSignal.current = refreshSignal;

  function renderActiveSection(section: SystemSectionKey) {
    if (desktopMode && !VALID_DESKTOP_SYSTEM_SECTION_KEYS.has(section)) return null;
    const refreshSignal = sectionRefreshSignals.current.get(section);
    switch (section) {
      case "appearance":
      case "hotkey":
      case "language":
        return <div className={`${sectionClassName} ${settingsStyles.vars}`}><GeneralSettingsPanel section={section} /></div>;
      case "windowClose":
        return <div className={`${sectionClassName} ${settingsStyles.vars}`}><WindowCloseSetting /></div>;
      case "tutorial":
        return <TutorialDocSection />;
      case "notice":
        return <SystemNoticeSection />;
      case "product":
        return <AdminOssSection />;
      case "errorGuide":
        return (
          <section id="sys-error-guide" className={sectionClassName}>
            <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]">
              <AlertTriangle className="h-4 w-4 text-amber-500" /><UiText id="admin.mf63c523592f4" /></h3>
            <p className="mb-4 text-[12px] text-[var(--app-muted)]"><UiText id="admin.me23198765135" /></p>
            <ErrorCodeGuidePanel />
          </section>
        );
      case "inspiration":
        return (
          <section id="sys-inspiration" className={sectionClassName}>
            <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]">
              <Sparkles className="h-4 w-4 text-violet-500" /><UiText id="admin.md430616e7530" /></h3>
            <p className="mb-4 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m4a460ba5fb96" /></p>
            <InspirationTemplatesPanel />
          </section>
        );
      case "materialAssets":
        return (
          <section id="sys-material-assets" className={sectionClassName}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]">
                  <Package2 className="h-4 w-4 text-emerald-500" /><UiText id="admin.m2ebbadf44163" /></h3>
                <p className="mt-2 text-[12px] text-[var(--app-muted)]"><UiText id="admin.mbd7259bd412a" /></p>
              </div>
              <Link
                href="/admin/material-assets?from=materialAssets"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 text-[13px] text-emerald-600 transition hover:bg-emerald-500/15 dark:text-emerald-300"
              >
                <Package2 className="h-4 w-4" /><UiText id="admin.m2c0b663213d7" /></Link>
            </div>
            {!desktopMode && (
              <>
                <MaterialRequestDocSection />
                <MaterialCreatorInspirationPermissions />
              </>
            )}
          </section>
        );
      case "imageEditModels":
        return (
          <section
            id="sys-image-edit-models"
            className={`${sectionClassName} lg:h-full lg:min-h-0`}
          >
            <ImageEditModelsPanel
              refreshSignal={refreshSignal}
              active={active && activeSection === "imageEditModels"}
            />
          </section>
        );
      case "billingPrices":
        return (
          <section
            id="sys-billing-prices"
            className={`${sectionClassName} lg:h-full lg:min-h-0`}
          >
            <BillingPriceRulesPanel
              refreshSignal={refreshSignal}
              active={active && activeSection === "billingPrices"}
            />
          </section>
        );
      case "presets":
        return (
          <BuiltinPresetsSection
            ref={builtinPresetsRef}
            onRequestDelete={onRequestDeleteBuiltinPreset}
          />
        );
      case "providers":
        return (
          <section
            id="sys-providers"
            className={`${sectionClassName} lg:h-full lg:min-h-0 lg:overflow-hidden`}
          >
            <ProvidersPanel
              refreshSignal={refreshSignal}
              active={active && activeSection === "providers"}
            />
          </section>
        );
      case "rolePositioning":
        return <RolePositioningSection />;
      case "segmentedPromptRule":
        return <SegmentedPromptRulePanel />;
      case "aliyunOss":
        return (
          <div className="space-y-6">
            <AdminMediaDeliverySection />
            <AdminAliyunOssSettingsSection />
          </div>
        );
      case "account":
      default:
        return (
          <section id="sys-account" className={sectionClassName}>
            <h3 className="mb-2 flex items-center gap-2 text-[16px] font-semibold text-[var(--app-fg)]">
              <Users className="h-4 w-4" /><UiText id="admin.ma3d3db4b55dc" /></h3>
            <p className="mb-4 text-[12px] text-[var(--app-muted)]"><UiText id="admin.med73306c9618" /></p>
            <UserManagement refreshSignal={refreshSignal} active={active && activeSection === "account"} />
          </section>
        );
    }
  }

  return (
    <div
      className="min-h-0 w-full lg:grid lg:h-[var(--system-panel-height)] lg:grid-cols-[var(--system-nav-width)_minmax(0,1fr)] lg:gap-[var(--system-nav-gap)]"
      style={
        {
          ["--system-nav-width" as any]: "260px",
          ["--system-nav-gap" as any]: "32px",
          ["--system-panel-height" as any]: "calc(100vh - 9.5rem)",
        } as React.CSSProperties
      }
    >
      <SystemNavSidebar
        entries={desktopMode ? DESKTOP_SYSTEM_SETTING_NAV_ENTRIES : navEntries}
        active={activeSection}
        onSelect={onSelectSection}
        onPrefetch={preloadAdminSystemSection}
      />

      <div
        ref={contentScrollRef as React.MutableRefObject<HTMLDivElement | null>}
        className={`mt-6 min-h-0 rounded-3xl border border-[var(--border-2)] bg-[var(--panel-bg)]/94 shadow-sm [&>div>*]:border-0 [&>div>*]:bg-transparent [&>div>*]:shadow-none lg:mt-0 lg:h-full ${activeSection === "providers" ? "lg:overflow-hidden dark:!bg-[#202020] dark:[--provider-surface:#202020]" : activeSection === "imageEditModels" ? "lg:overflow-y-auto dark:!bg-[#202020]" : "lg:overflow-y-auto"}`}
      >
        {mountedSections.current.map((section) => (
          <div
            key={section}
            className={section === activeSection ? "contents" : "hidden"}
            aria-hidden={section === activeSection ? undefined : true}
          >
            {renderActiveSection(section)}
          </div>
        ))}
      </div>
    </div>
  );
}
