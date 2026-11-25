import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import messages from "@/messages/zh-CN.json";
import {
  SYSTEM_SETTING_NAV_ENTRIES,
  SYSTEM_SETTING_SECTIONS,
  VALID_SYSTEM_SECTION_KEYS,
  getSystemScrollMarker,
} from "@/components/admin/system-navigation";

function localizedLabel<T extends { label: string }>(entry: T) {
  const key = entry.label.split(".")[1] as keyof typeof messages.admin;
  return { ...entry, label: messages.admin[key] };
}

describe("admin system navigation model", () => {
  it("groups every setting into one of four categories", () => {
    expect(SYSTEM_SETTING_NAV_ENTRIES.map((entry) => entry.key)).toEqual([
      "accountAccess",
      "contentResources",
      "aiModels",
      "systemIntegration",
    ]);

    const flattenedKeys = SYSTEM_SETTING_SECTIONS.map((section) => section.key);
    expect(new Set(flattenedKeys).size).toBe(flattenedKeys.length);
    expect(flattenedKeys).toHaveLength(14);
    expect(flattenedKeys).toContain("product");
    expect(flattenedKeys).not.toContain("oss");
    expect(VALID_SYSTEM_SECTION_KEYS.has("notice")).toBe(true);
    expect(VALID_SYSTEM_SECTION_KEYS.has("segmentedPromptRule")).toBe(true);
    const skillIndex = flattenedKeys.indexOf("rolePositioning");
    expect(localizedLabel(SYSTEM_SETTING_SECTIONS[skillIndex + 1])).toEqual({
      type: "item",
      key: "segmentedPromptRule",
      id: "sys-segmented-prompt-rule",
      label: "批量分段规则",
    });
  });

  it("places API configuration immediately after toolbox models", () => {
    const aiModelsGroup = SYSTEM_SETTING_NAV_ENTRIES.find(
      (entry) => entry.key === "aiModels",
    );
    const systemGroup = SYSTEM_SETTING_NAV_ENTRIES.find(
      (entry) => entry.key === "systemIntegration",
    );
    if (!aiModelsGroup) throw new Error("AI models group missing");
    if (!systemGroup) throw new Error("system integration group missing");

    expect(aiModelsGroup.items.map((item) => item.key)).toEqual([
      "imageEditModels",
      "providers",
      "billingPrices",
      "presets",
    ]);
    expect(systemGroup.items.some((item) => item.key === "providers")).toBe(
      false,
    );
  });

  it("places batch rules after skills and before OSS", () => {
    const group = SYSTEM_SETTING_NAV_ENTRIES.find(
      (entry) => entry.key === "systemIntegration",
    );
    if (!group) throw new Error("system integration group missing");

    expect(group.items.map((item) => item.key)).toEqual([
      "rolePositioning",
      "segmentedPromptRule",
      "aliyunOss",
    ]);
    expect(localizedLabel(group.items[2])).toEqual({
      type: "item",
      key: "aliyunOss",
      id: "sys-aliyun-oss",
      label: "对象存储（阿里云 OSS）",
    });
  });

  it("keeps an element scroller marker inside a short section positioned near the top", () => {
    const marker = getSystemScrollMarker(136, 777, false);

    expect(marker).toBeGreaterThan(176);
    expect(marker).toBeLessThan(291);
    expect(getSystemScrollMarker(136, 777, true)).toBeGreaterThan(291);
  });

  it("keeps every categorized child item visible in the sidebar", () => {
    const sidebar = readFileSync(
      resolve(process.cwd(), "components/admin/SystemNavSidebar.tsx"),
      "utf8",
    );

    expect(sidebar).toContain("entries.map((entry)");
    expect(sidebar).toContain("entry.items.map");
    expect(sidebar).not.toContain("openGroupKey");
    expect(sidebar).not.toContain("aria-expanded");
  });

  it("mounts the active settings module and preserves visited modules", () => {
    const systemTab = readFileSync(
      resolve(process.cwd(), "components/admin/AdminSystemTab.tsx"),
      "utf8",
    );

    expect(systemTab).toContain("function renderActiveSection");
    expect(systemTab).toContain("switch (section)");
    expect(systemTab).toContain('case "notice"');
    expect(systemTab).toContain("const mountedSections = React.useRef<SystemSectionKey[]>([])");
    expect(systemTab).toContain("mountedSections.current.map((section)");
    expect(systemTab).toContain("renderActiveSection(section)");
    expect(systemTab).toContain('["--system-nav-gap" as any]: "32px"');
    expect(systemTab).toContain(
      "lg:grid-cols-[var(--system-nav-width)_minmax(0,1fr)]",
    );
    expect(systemTab).toContain("lg:gap-[var(--system-nav-gap)]");
    expect(systemTab).toContain("lg:h-[var(--system-panel-height)]");
    expect(systemTab).not.toContain(
      "calc(var(--admin-fixed-nav-offset)+var(--system-nav-width)+var(--system-nav-gap))",
    );
  });

  it("uses the shared navigation model and switches the single active section directly", () => {
    const page = readFileSync(
      resolve(process.cwd(), "app/admin/page.tsx"),
      "utf8",
    );

    expect(page).toContain("SYSTEM_SETTING_NAV_ENTRIES");
    expect(page).toContain("VALID_SYSTEM_SECTION_KEYS");
    expect(page).toContain("setSystemSectionActive(key)");
    expect(page).toContain('settingsContentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" })');
    expect(page).not.toContain("pendingScrollSection");
    expect(page).not.toContain('behavior: "smooth"');
    expect(page).not.toContain("systemNavLockUntilRef");
    expect(page).toContain("navEntries={SYSTEM_SETTING_NAV_ENTRIES}");
    expect(page).toContain("pt-[116px] md:pt-[96px] xl:pt-[76px]");
    expect(page).not.toContain("const SYSTEM_SETTING_SECTIONS = [");
    expect(page).not.toContain(
      "const VALID_SYSTEM_SECTION_KEYS = new Set<SystemSectionKey>([",
    );
  });
});
