import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(
  resolve(process.cwd(), "components/role-skills/role-skill-dialog.tsx"),
  "utf8",
);

describe("shared role skill side panel", () => {
  it("starts collapsed for every dialog opening and only expands on request", () => {
    expect(dialogSource).toContain(
      "const [sidePanelOpen, setSidePanelOpen] = React.useState(false)",
    );
    expect(dialogSource).toContain("setSidePanelOpen(false)");
    expect(dialogSource).toContain("sidePanelOpen ? (");
    expect(dialogSource).toContain('aria-label="展开技能面板"');
    expect(dialogSource).toContain('aria-label="收起技能面板"');
  });

  it("keeps all feature entry points on the shared dialog behavior", () => {
    const batchSource = readFileSync(
      resolve(
        process.cwd(),
        "components/batch-workbench/batch-role-positioning.tsx",
      ),
      "utf8",
    );
    const imageToolSource = readFileSync(
      resolve(process.cwd(), "app/image/image-tool.tsx"),
      "utf8",
    );

    expect(batchSource).toContain("<RoleSkillDialog");
    expect(imageToolSource).toContain("<RoleSkillDialog");
  });

  it("uses a user-facing result title without the LLM implementation term", () => {
    expect(dialogSource).toContain("<span>生成结果</span>");
    expect(dialogSource).not.toContain("LLM 生成结果");
  });
});
