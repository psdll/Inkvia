import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ProvidersPanel", () => {
  it("does not render the recommended-provider quick-add section", () => {
    const source = readFileSync(resolve(process.cwd(), "components/admin/ProvidersPanel.tsx"), "utf8");

    expect(source).not.toContain("推荐平台");
    expect(source).not.toContain("一键添加");
    expect(source).not.toContain("环境变量名（可选，仅作回退）");
    expect(source).not.toContain('[row.id]: "busy"');
    expect(source).not.toContain('[`${row.id}:probe`] === "busy"');
    expect(source).not.toContain('label="探测协议"');
    expect(source).toContain('title="统一代理"');
    expect(source).toContain('type="password"');
    expect(source).toContain("expectedRevision,");
    expect(source).toContain("proxyAction");
    expect(source).toContain("const saveProxy = async (proxyAction: ProxyAction)");
    expect(source).toContain("requestProviderAdminProxySave(fetch, { expectedRevision, proxyAction })");
    expect(source).not.toContain("添加OpenAI 协议的API平台");
    expect(source).not.toContain("addCustomProvider");
    expect(source).not.toContain("添加 OpenAI-compatible Chat 平台");
    expect(source).toContain('value={row.egressMode}');
    expect(source.indexOf('label="测试线路"')).toBeLessThan(source.indexOf('label="拉取模型"'));
  });
});
