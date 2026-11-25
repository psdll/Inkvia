import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("administrator database log scopes", () => {
  it("lets administrators switch between audit, user action, and all business logs", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/admin/AdminLogsPanel.tsx"),
      "utf8",
    );

    expect(source).toContain("管理员审计");
    expect(source).toContain("用户行为");
    expect(source).toContain("全部业务日志");
    expect(source).toContain('params.set("category", "user_action")');
    expect(source).toContain("只记录已接入日志组件的关键操作");
  });
});
