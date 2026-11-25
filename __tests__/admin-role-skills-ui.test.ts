import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("administrator system Skill management", () => {
  it("keeps the Skill title without the legacy visibility switch", () => {
    const navigation = source("components/admin/system-navigation.ts");
    const section = source("components/admin/RolePositioningSection.tsx");
    const panel = source("components/admin/SystemRoleSkillsPanel.tsx");

    expect(navigation).toContain('key: "rolePositioning"');
    expect(navigation).toContain('id: "sys-role-positioning"');
    expect(navigation).toContain('label: "技能"');
    expect(section).toContain('id="sys-role-positioning"');
    expect(panel).toMatch(/<h3\b[^>]*>\s*<SkillModuleIcon\b[^>]*\/>\s*技能<\/h3>/);
    expect(section).not.toContain('/api/admin/settings/role-positioning');
    expect(section).not.toContain('body: JSON.stringify({ enabled })');
    expect(section).not.toContain("保存显示开关");
    expect(section).toContain("<SystemRoleSkillsPanel />");
  });

  it("offers full system Skill lifecycle management with shared themed controls", () => {
    const panel = source("components/admin/SystemRoleSkillsPanel.tsx");
    const editorPage = source("components/admin/SystemRoleSkillEditorPage.tsx");

    expect(panel).toContain("listSystemRoleSkillsAdmin");
    expect(panel).toContain("getSystemRoleSkillAdmin");
    expect(editorPage).toContain("createSystemRoleSkillAdmin");
    expect(editorPage).toContain("updateSystemRoleSkillAdmin");
    expect(panel).not.toContain("copySystemRoleSkillAdmin");
    expect(panel).toContain("deleteSystemRoleSkillAdmin");
    expect(panel).toContain("restoreSystemRoleSkillAdmin");
    expect(editorPage).toContain('mode="system-admin"');
    expect(panel).toContain("<RoleSkillCard");
    expect(panel).toContain("<RoleSkillDetailDialog");
    expect(panel).not.toContain("完整 Skill 内容");
    expect(panel).toContain("SKILL_REVISION_CONFLICT");
    expect(panel).toContain("published");
    expect(panel).toContain("hidden");
    expect(panel).toContain("deleted");
    expect(panel).toContain("FrostedSelect");
    expect(panel).not.toMatch(/<select\b/);
  });

  it("keeps rendered Skill cards in place during background refreshes", () => {
    const panel = source("components/admin/SystemRoleSkillsPanel.tsx");

    expect(panel).toContain(
      "const [initialized, setInitialized] = React.useState(() => Boolean(cachedSystemSkills()));",
    );
    expect(panel).toContain("const initialLoading = loading && !initialized;");
    expect(panel).toContain("{initialLoading ?");
    expect(panel).toContain("{initialized && visibleSkills.length === 0 ?");
    expect(panel).not.toContain('{loading ? <div className="py-12');
  });

  it("explains the 30-day system Skill recovery window before deletion", () => {
    const panel = source("components/admin/SystemRoleSkillsPanel.tsx");

    expect(panel).toContain("<ConfirmDialog");
    expect(panel).toContain("open={Boolean(pendingDeleteSkill)}");
    expect(panel).toContain("删除后可在 30 天内从“已删除”筛选中恢复");
    expect(panel).toContain("超过 30 天将永久删除");
  });

  it("opens system Skill creation and editing in one dedicated browser page", () => {
    const panel = source("components/admin/SystemRoleSkillsPanel.tsx");
    const routePath = resolve(process.cwd(), "app/admin/role-skills/editor/page.tsx");
    const pagePath = resolve(process.cwd(), "components/admin/SystemRoleSkillEditorPage.tsx");

    expect(existsSync(routePath)).toBe(true);
    expect(existsSync(pagePath)).toBe(true);
    if (!existsSync(routePath) || !existsSync(pagePath)) return;

    const route = source("app/admin/role-skills/editor/page.tsx");
    const page = source("components/admin/SystemRoleSkillEditorPage.tsx");
    expect(panel).toContain('const pendingTab = window.open("", "_blank");');
    expect(panel).toContain("pendingTab.opener = null;");
    expect(panel).toContain('const editorUrl = skillId');
    expect(panel).toContain('"/admin/role-skills/editor"');
    expect(panel).toContain("onClick={() => openEditorPage()}");
    expect(panel).toContain("onEdit={detailSkill && !detailSkill.deletedAt ? () => openEditorPage(detailSkill.id) : undefined}");
    expect(route).toContain("<SystemRoleSkillEditorPage />");
    expect(page).toContain('searchParams.get("skillId")');
    expect(page).toContain("listSystemRoleSkillsAdmin");
    expect(page).toContain("createSystemRoleSkillAdmin");
    expect(page).toContain("updateSystemRoleSkillAdmin");
    expect(page).toContain("<RoleSkillEditor");
    expect(page).toContain("key={editorKey}");
    expect(page).toContain('mode="system-admin"');
    expect(page).toContain('React.useState<RoleSkillStatus>("published")');
    expect(page).toContain("FrostedSelect");
  });

  it("removes the nested editor header and keeps close at the page top right", () => {
    const page = source("components/admin/SystemRoleSkillEditorPage.tsx");
    const editor = source("components/role-skills/role-skill-editor.tsx");

    expect(page).toContain("hideHeader");
    expect(page).toContain('aria-label="关闭系统 Skill 页面"');
    expect(editor).toContain("hideHeader = false");
    expect(editor).toContain("{hideHeader ? null : (");
    expect(page.indexOf('aria-label="关闭系统 Skill 页面"')).toBeLessThan(
      page.indexOf("<RoleSkillEditor"),
    );
  });

  it("uses dedicated administrator APIs and cover routes", () => {
    const client = source("lib/role-skills/client.ts");
    const editor = source("components/role-skills/role-skill-editor.tsx");

    expect(client).toContain('"/api/admin/role-skills/system"');
    expect(client).toContain("/api/admin/role-skills/system/${encodeURIComponent(skillId)}");
    expect(client).not.toContain("/copy");
    expect(client).toContain("/restore");
    expect(editor).toContain('mode === "system-admin"');
    expect(client).toContain('"/api/admin/role-skills/system/cover"');
  });

  it("places writable skill content beside settings while retaining read-only fields", () => {
    const editor = source("components/role-skills/role-skill-editor.tsx");
    const page = source("components/admin/SystemRoleSkillEditorPage.tsx");
    const usageIndex = editor.indexOf('label="如何使用"');
    const readOnlyTypeIndex = editor.indexOf("{splitLayout ? null : mediaTypeField}");
    const readOnlyCoverIndex = editor.indexOf("{splitLayout ? null : coverField}");

    expect(editor).toContain("MEDIA_TYPE_OPTIONS");
    expect(editor).toContain('{ value: "image", label: "图片" }');
    expect(editor).toContain('{ value: "video", label: "视频" }');
    expect(editor).toContain('{ value: "audio", label: "音频" }');
    expect(editor).toContain('{ value: "text", label: "文本" }');
    expect(editor).toContain("if (coverFile)");
    expect(usageIndex).toBeGreaterThan(-1);
    expect(readOnlyTypeIndex).toBeGreaterThan(usageIndex);
    expect(readOnlyCoverIndex).toBeGreaterThan(readOnlyTypeIndex);
    expect(editor).toContain('aria-label="技能内容工作区"');
    expect(editor).toContain('aria-label="技能设置"');
    expect(editor).toContain("{splitLayout ? mediaTypeField : null}");
    expect(editor).toContain("{splitLayout ? coverField : null}");
    expect(editor).toContain("fillHeight={splitLayout}");
    expect(page).toContain("settingsHeader={");
    expect(page).toContain("h-dvh");
    expect(page).not.toContain("max-w-[1440px]");
    expect(page).toContain("mediaType={mediaType}");
    expect(page).toContain("onMediaTypeChange={setMediaType}");
    expect(page).toContain('React.useState<RoleSkillMediaType>("image")');
  });

  it("lets an administrator bind a system Skill as the Live default", () => {
    const editor = source("components/role-skills/role-skill-editor.tsx");
    const page = source("components/admin/SystemRoleSkillEditorPage.tsx");
    const client = source("lib/role-skills/client.ts");
    const features = source("lib/role-skills/features.ts");

    expect(editor).toContain("ROLE_SKILL_FEATURES");
    expect(editor).toContain("功能绑定");
    expect(editor).toContain("指定使用此 Skill 的功能");
    expect(editor).toContain("每个功能只能绑定一个默认 Skill");
    expect(editor).not.toContain("默认使用功能");
    expect(features).toContain("批量生成视频用于 Live");
    expect(editor).toContain('role="checkbox"');
    expect(page).toContain("featureKeys");
    expect(page).toContain("setFeatureKeys");
    expect(client).toContain("featureKeys");
  });

  it("loads user-specific admin data only while the user management tab is active", () => {
    const page = source("app/admin/page.tsx");

    expect(page).toMatch(
      /React\.useEffect\(\(\) => \{\s+if \(mainTab !== "users"\) return;\s+void ensureUsersLoaded\(\);\s+\}, \[ensureUsersLoaded, mainTab\]\);/,
    );
    expect(page).toMatch(
      /React\.useEffect\(\(\) => \{\s+if \(mainTab !== "users"\) return;\s+const background = tab === "materials"[\s\S]+?void loadUser\([\s\S]+?\}, \[loadUser, mainTab, tab\]\);/,
    );
  });

  it("keeps storage and retention reads scoped to the overview tab", () => {
    const page = source("app/admin/page.tsx");
    const storageHook = source("lib/hooks/use-admin-storage.ts");

    expect(page).toContain(
      'useAdminStorage({ enabled: mainTab === "overview" });',
    );
    expect(storageHook).toContain(
      "export function useAdminStorage({ enabled = true }: { enabled?: boolean } = {})",
    );
    expect(storageHook).toContain("enabled,");
    expect(page).toMatch(
      /React\.useEffect\(\(\) => \{\s+if \(mainTab !== "overview"\) return;\s+void loadStorage\(\);\s+\}, \[loadStorage, mainTab\]\);/,
    );
    expect(page).toMatch(
      /React\.useEffect\(\(\) => \{\s+if \(mainTab !== "overview"\) return;\s+void loadRetentionSettings\(\);\s+\}, \[loadRetentionSettings, mainTab\]\);/,
    );
  });

  it("warms lightweight administrator tabs on idle, hover, and focus", () => {
    const page = source("app/admin/page.tsx");
    const header = source("components/admin/AdminTopHeader.tsx");

    expect(page).toContain('import { scheduleIdleBatches } from "@/lib/browser/idle-batches";');
    expect(page).toContain("ADMIN_PREFETCH_IDLE_DELAY_MS");
    expect(page).toContain('prefetchMainTab("users")');
    expect(page).toContain('prefetchMainTab("system")');
    expect(page).not.toContain('prefetchMainTab("overview")');
    expect(page).toContain("onPrefetch={prefetchMainTab}");
    expect(header).toContain("onMouseEnter={onPrefetch}");
    expect(header).toContain("onFocus={onPrefetch}");
  });

  it("reuses fresh lightweight admin data without preloading heavy user details", () => {
    const page = source("app/admin/page.tsx");
    const storageHook = source("lib/hooks/use-admin-storage.ts");

    expect(page).toContain("const ADMIN_PREFETCH_TTL_MS = 30 * 1000;");
    expect(page).toContain("usersLoadedAtRef");
    expect(page).toContain("usersLoadPromiseRef");
    expect(page).toContain("const ensureUsersLoaded = React.useCallback");
    expect(page).toContain("retentionLoadedAtRef");
    expect(page).toContain("retentionLoadPromiseRef");
    expect(storageHook).toContain(
      "staleTime: options?.force ? 0 : ADMIN_STORAGE_STALE_TIME_MS,",
    );

    const prefetchStart = page.indexOf("const prefetchMainTab = React.useCallback");
    const prefetchEnd = page.indexOf("const prefetchFrequentAdminTabs", prefetchStart);
    expect(prefetchStart).toBeGreaterThan(-1);
    expect(prefetchEnd).toBeGreaterThan(prefetchStart);
    const prefetchBlock = page.slice(prefetchStart, prefetchEnd);
    expect(prefetchBlock).toContain("ensureUsersLoaded");
    expect(prefetchBlock).toContain("loadStorage");
    expect(prefetchBlock).toContain("loadRetentionSettings");
    expect(prefetchBlock).not.toContain("loadUser(");
  });

  it("keeps administrator tab switches shallow so page-level caches survive", () => {
    const page = source("app/admin/page.tsx");

    expect(page).toContain(
      'window.history.replaceState(null, "", query ? `/admin?${query}` : "/admin");',
    );
    expect(page).not.toContain("router.replace(");
    expect(page).not.toContain("useRouter()");
  });

  it("renders a new system Skill editor before category discovery finishes", () => {
    const page = source("components/admin/SystemRoleSkillEditorPage.tsx");

    expect(page).toContain(
      "const [loading, setLoading] = React.useState(Boolean(skillId));",
    );
    expect(page).toContain("void listSystemRoleSkillsAdmin()");
    expect(page).toContain("if (!skillId) {");
    expect(page).toContain("setLoading(false);");
    expect(page).toContain("void getSystemRoleSkillAdmin(skillId)");
    expect(page).not.toContain(
      "return getSystemRoleSkillAdmin(skillId).then",
    );
  });
});
