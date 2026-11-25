import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_SETTING_NAV_ENTRIES } from "@/components/admin/system-navigation";
import messages from "@/messages/zh-CN.json";

describe("role skill settings UI", () => {
  it("renames the visible entry while preserving its compatibility identifiers", () => {
    const group = SYSTEM_SETTING_NAV_ENTRIES.find(
      (entry) => entry.key === "systemIntegration",
    );

    expect(group?.items).toContainEqual({
      type: "item",
      key: "rolePositioning",
      id: "sys-role-positioning",
      label: "admin.nav_rolePositioning",
    });
    expect(messages.admin.nav_rolePositioning).toBe("技能");
  });

  it("mounts the Skill management module without visibility controls", () => {
    const systemTabSource = readFileSync(
      resolve(process.cwd(), "components/admin/AdminSystemTab.tsx"),
      "utf8",
    );
    const panelPath = resolve(
      process.cwd(),
      "components/admin/RolePositioningSection.tsx",
    );

    expect(existsSync(panelPath)).toBe(true);
    const panelSource = readFileSync(panelPath, "utf8");

    expect(systemTabSource).toContain(
      'import("@/components/admin/RolePositioningSection")',
    );
    expect(systemTabSource).toContain(
      "const RolePositioningSection = dynamic(loadRolePositioningSection,",
    );
    expect(systemTabSource).toContain('case "rolePositioning"');
    expect(systemTabSource).toContain("<RolePositioningSection />");
    expect(panelSource).toContain('id="sys-role-positioning"');
    expect(panelSource).toContain("<SystemRoleSkillsPanel />");
    expect(panelSource).not.toContain('/api/admin/settings/role-positioning');
    expect(panelSource).not.toContain("显示技能");
    expect(panelSource).not.toContain("保存显示开关");
  });

  it("keeps the image editor Skill entry visible without a setting request", () => {
    const imageToolSource = readFileSync(
      resolve(process.cwd(), "app/image/image-tool.tsx"),
      "utf8",
    );

    expect(imageToolSource).toContain("<RoleSkillTrigger");
    expect(imageToolSource).not.toContain("rolePositioningVisible");
    expect(imageToolSource).not.toContain('/api/role-positioning/status');
  });

  it("routes role prompting through the unified image LLM gateway", () => {
    const promptReverseRoute = readFileSync(
      resolve(process.cwd(), "app/api/prompt-reverse/route.ts"),
      "utf8",
    );

    expect(promptReverseRoute).toContain('resolveLlmRoute("image.role_prompt")');
    expect(promptReverseRoute).toContain("callLlmForScenario");
    expect(promptReverseRoute).not.toMatch(/process\.env\.(APIMART|OPENAI|EASYROUTER).*KEY/);
    expect(promptReverseRoute).not.toMatch(/\bapimart\b/i);
  });

  it("places a compact neutral role positioning button in the inline prompt header", () => {
    const imageToolSource = readFileSync(
      resolve(process.cwd(), "app/image/image-tool.tsx"),
      "utf8",
    );
    const promptEditor = imageToolSource.slice(
      imageToolSource.indexOf("const renderPromptEditor"),
      imageToolSource.indexOf("const mainContent"),
    );
    const inlinePromptHeader = imageToolSource.slice(
      imageToolSource.indexOf('<span>编辑提示词</span>'),
      imageToolSource.indexOf('<div ref={promptSourceRef}'),
    );

    expect(promptEditor).not.toContain("RoleSkillTrigger");
    expect(inlinePromptHeader).toContain("<RoleSkillTrigger");
    expect(inlinePromptHeader).toContain('setSkillLibraryEntry({ view: "browse" }); setSystemPromptOpen(true);');
    expect(inlinePromptHeader).not.toContain("rolePositioningVisible");
    expect(inlinePromptHeader).not.toContain("blue-");
    expect(inlinePromptHeader).not.toContain("{prompt.length}字");
    expect(imageToolSource.match(/\{prompt\.length\}字/g)).toHaveLength(1);
  });

  it("persists the latest toolbox role draft in its own account scope", () => {
    const imageToolSource = readFileSync(
      resolve(process.cwd(), "app/image/image-tool.tsx"),
      "utf8",
    );

    expect(imageToolSource).toContain("useAccountRolePositioningDraft");
    expect(imageToolSource).toContain('surface: "toolbox_image"');
    expect(imageToolSource).toContain(
      'fetch("/api/prompt-reverse?limit=50&surface=toolbox_image"',
    );
    expect(imageToolSource).not.toContain("localStorage.setItem(reverseDraftKey");
  });
});
