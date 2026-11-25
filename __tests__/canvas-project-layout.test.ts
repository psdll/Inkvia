import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(process.cwd(), "app/canvas/page.tsx"), "utf8");
const route = readFileSync(resolve(process.cwd(), "app/api/canvas/[id]/project-metadata/route.ts"), "utf8");

describe("streamlined canvas project page", () => {
  it("keeps the project search, toolbar trash and create entry", () => {
    for (const label of ["搜索项目", "回收站", "开始创作"]) {
      expect(page).toContain(label);
    }
    expect(page).toContain("data-canvas-project-grid");
  });

  it("keeps only the required project-card actions", () => {
    for (const label of ["打开", "重命名", "删除项目"]) {
      expect(page).toContain(label);
    }
    for (const removed of ["修改封面", "创建副本", "移动至文件夹", "duplicateCanvas", "coverInputRef", "moveCanvas"]) {
      expect(page).not.toContain(removed);
    }
  });

  it("removes the boxed navigation and folder controls", () => {
    for (const removed of ["新建文件夹", "全部画布", "未归档", "AI Agent", "创作者挑战赛"]) {
      expect(page).not.toContain(removed);
    }
  });

  it("removes the sidebar and keeps a way back from trash", () => {
    expect(page).not.toContain("<aside");
    expect(page).not.toContain("创作空间");
    expect(page).toContain("返回项目");
  });

  it("accepts authenticated list-page title updates", () => {
    expect(page).toContain("/project-metadata");
    expect(route).toContain("title?: string");
  });

  it("uses the shared project dialog instead of browser-native prompts", () => {
    expect(page).toContain('import { ConfirmDialog } from "@/components/ui/confirm-dialog"');
    expect(page).toContain('<ConfirmDialog');
    expect(page).not.toContain("window.prompt");
    expect(page).not.toContain("window.confirm");
    expect(page).not.toContain("window.alert");
  });
});
