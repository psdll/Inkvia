import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("image tool initial loading", () => {
  it("keeps editor and dialog-only modules out of the initial image-tool chunk", () => {
    const source = readFileSync("app/image/image-tool.tsx", "utf8");

    expect(source).not.toContain('import { PromptRichEditor } from "@/components/ui/prompt-rich-editor"');
    expect(source).not.toContain('import { PresetPromptsTrigger } from "@/components/presets/preset-prompts"');
    expect(source).not.toContain('import { RoleSkillDialog } from "@/components/role-skills/role-skill-dialog"');
    expect(source).toContain('dynamic(() => import("@/components/ui/prompt-rich-editor")');
    expect(source).toContain('dynamic(() => import("@/components/presets/preset-prompts")');
    expect(source).toContain('dynamic(() => import("@/components/role-skills/role-skill-dialog")');
  });

  it("loads the image tool lazily when selected", () => {
    const source = readFileSync("app/studio/page.tsx", "utf8");

    expect(source).toContain('const loadImagePage = () => import("@/app/image/image-tool")');
    expect(source).toContain("dynamic(loadImagePage");
    expect(source).not.toContain("void loadImagePage();");
  });

  it("mounts the URL-selected tool first and retains visited workspaces", () => {
    const source = readFileSync("app/studio/page.tsx", "utf8");

    expect(source).toContain("const searchParams = useSearchParams();");
    expect(source).toContain("const initialTool = normalizeTool(searchParams.get(\"tool\"));");
    expect(source).toContain("React.useState<Tool>(initialTool)");
    expect(source).toContain('new Set<StudioTool>([initialTool])');
  });

  it("wraps the Studio search-parameter consumer in a Suspense boundary", () => {
    const source = readFileSync("app/studio/page.tsx", "utf8");

    expect(source).toContain("function StudioPageContent()");
    expect(source).toContain("<React.Suspense fallback={<StudioLoading />}>");
    expect(source).toContain("<StudioPageContent />");
  });
});
