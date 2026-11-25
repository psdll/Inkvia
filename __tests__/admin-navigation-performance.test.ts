import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("admin navigation performance", () => {
  it("mounts the active overview immediately while keeping inactive heavy panels split", () => {
    const source = read("app/admin/page.tsx");

    expect(source).toContain('import dynamic from "next/dynamic"');
    expect(source).toContain('const loadAdminOverviewTab = () => import("@/components/admin/AdminOverviewTab")');
    expect(source).not.toContain('<AtomicPageReveal ready=');
    expect(source).toContain('const loadAdminSystemTab = () => import("@/components/admin/AdminSystemTab")');
    expect(source).toContain('const loadUserAnalysisPanel = () => import("@/components/admin/UserAnalysisPanel")');
    expect(source).toContain('const loadUserWorksPanel = () => import("@/components/admin/UserWorksPanel")');
    expect(source).toContain('const loadUserMaterialAssetsPanel = () => import("@/components/admin/UserMaterialAssetsPanel")');
    expect(source).not.toContain('import AdminSystemTab from');
    expect(source).not.toContain('import UserAnalysisPanel from');
    expect(source).not.toContain('import UserWorksPanel from');
    expect(source).not.toContain('import UserMaterialAssetsPanel from');
    expect(source).not.toContain('import UserAgentPanel from');
  });

  it("warms the selected heavy panel only after administrator intent", () => {
    const source = read("app/admin/page.tsx");

    expect(source).toContain('if (nextTab === "system")');
    expect(source).toContain("void loadAdminSystemTab().then");
    expect(source).toContain("preloadAdminSystemSection(systemSectionActive)");
    expect(source).toContain("void loadUserAnalysisPanel();");
    expect(source).toContain("void loadAdminOverviewTab();");
  });

  it("coalesces duplicate development GETs across strict-mode mounts", () => {
    const contracts = [
      ["components/admin/AdminSessionGate.tsx", 'fetchJsonOnce<{ authenticated?: boolean }>("/api/admin/session")'],
      ["components/admin/FeedbackCenterPanel.tsx", 'fetchJsonOnce<{ items?: FeedbackCenterItem[]; error?: string }>("/api/admin/feedback/list?take=500")'],
      ["components/admin/AdminLogsPanel.tsx", "fetchJsonOnce<any>(`/api/admin/logs?${params.toString()}`)"],
    ] as const;

    for (const [path, call] of contracts) {
      const source = read(path);
      expect(source, path).toContain('import { fetchJsonOnce } from "@/lib/client/inflight-json"');
      expect(source, path).toContain(call);
    }
  });

  it("warms user-detail panels from tab intent", () => {
    const page = read("app/admin/page.tsx");
    const tabBar = read("components/admin/UserDetailTabBar.tsx");

    expect(tabBar).toContain("onPrefetch?: (tab: UserDetailTab) => void");
    expect(tabBar).toContain("onMouseEnter={onPrefetch}");
    expect(tabBar).toContain("onFocus={onPrefetch}");
    expect(page).toContain("const prefetchUserDetailTab = React.useCallback");
    expect(page).toContain("void loadUserWorksPanel();");
    expect(page).toContain("void loadUserMaterialAssetsPanel();");
    expect(page).toContain("void loadUserRoleSkillsPanel();");
    expect(page).toContain("onPrefetch={prefetchUserDetailTab}");
  });

  it("requests only the data section required by each user-detail panel", () => {
    const page = read("app/admin/page.tsx");

    expect(page).toContain('if (tab === "materials") url.searchParams.set("section", "materials")');
    expect(page).toContain('else if (tab === "presets") url.searchParams.set("section", "presets")');
    expect(page).toContain('else if (tab === "skills") url.searchParams.set("section", "skills")');
    expect(page).toContain('else url.searchParams.set("section", "profile")');
    expect(page).toContain('if (tab === "presets") return "presets"');
  });

  it("does not auto-load the entire user works history on first render", () => {
    const works = read("components/admin/UserWorksPanel.tsx");

    expect(works).toContain("useAutoPaginate");
    expect(works).toContain("onLoadPage");
    expect(works).toContain("minScrollableScreens: 1.5");
    expect(works).not.toContain("while (hasMore)");
    expect(read("app/admin/page.tsx")).toContain('String(pagination?.pageSize || 40)');

  });

  it("coalesces the duplicate billing request from strict-mode mounts", () => {
    const billing = read("components/admin/MonthlyBillingPanel.tsx");

    expect(billing).toContain('import { fetchJsonOnce } from "@/lib/client/inflight-json"');
    expect(billing).toContain("fetchJsonOnce<any>(`/api/admin/billing/monthly?${params}`)");
  });

  it("loads settings on intent and keeps visited pages mounted without bulk warmup", () => {
    const page = read("app/admin/page.tsx");
    const systemTab = read("components/admin/AdminSystemTab.tsx");
    const sidebar = read("components/admin/SystemNavSidebar.tsx");

    expect(systemTab).toContain('import dynamic from "next/dynamic"');
    expect(systemTab).not.toContain('import { scheduleIdleBatches } from "@/lib/browser/idle-batches"');
    expect(systemTab).toContain('const loadUserManagement = () => import("@/components/admin/UserManagement")');
    expect(systemTab).toContain('const loadProvidersPanel = () => import("@/components/admin/ProvidersPanel")');
    expect(systemTab).toContain("export function preloadAdminSystemSection");
    expect(systemTab).not.toContain("SYSTEM_SECTION_WARMUP_ORDER");
    expect(page).toMatch(/if \(mainTab === "system"\) return;\s+let cancelIdle/);
    expect(systemTab).toContain("const mountedSections = React.useRef<SystemSectionKey[]>([])");
    expect(systemTab).toContain("mountedSections.current.includes(activeSection)");
    expect(systemTab).toContain("mountedSections.current.map((section)");
    expect(sidebar).toContain("onPrefetch?: (key: SystemSectionKey) => void");
    expect(sidebar).toContain("onMouseEnter={onPrefetch}");
    expect(sidebar).toContain("onFocus={onPrefetch}");
    expect(page).toContain("preloadAdminSystemSection(systemSectionActive)");
  });

  it("coalesces strict-mode GETs for system-setting sections", () => {
    const sections = [
      "components/admin/TutorialDocSection.tsx",
      "components/admin/SystemNoticeSection.tsx",
      "components/admin/ImageEditModelsPanel.tsx",
      "components/admin/ModelCostsPanel.tsx",
      "components/admin/BuiltinPresetsSection.tsx",
      "components/admin/InspirationTemplatesPanel.tsx",
      "components/admin/AdminAliyunOssSettingsSection.tsx",
    ];

    for (const path of sections) {
      const source = read(path);
      expect(source, path).toContain('import { fetchJsonOnce } from "@/lib/client/inflight-json"');
      expect(source, path).toContain("fetchJsonOnce<");
    }
  });
});
