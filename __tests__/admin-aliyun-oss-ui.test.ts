import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin aliyun OSS settings UI", () => {
  it("mounts a dedicated module and leaves product library intact", () => {
    const tab = readFileSync(
      resolve(process.cwd(), "components/admin/AdminSystemTab.tsx"),
      "utf8",
    );
    const product = readFileSync(
      resolve(process.cwd(), "components/admin/AdminOssSection.tsx"),
      "utf8",
    );

    expect(tab).toContain('case "aliyunOss":');
    expect(tab).toContain("<AdminAliyunOssSettingsSection />");
    expect(product).toContain("产品库");
  });

  it("shows six fields, masks Secret, and saves to the admin API", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "components/admin/AdminAliyunOssSettingsSection.tsx",
      ),
      "utf8",
    );

    for (const label of [
      "Endpoint",
      "Region",
      "Bucket",
      "AccessKey ID",
      "AccessKey Secret",
      "Public Base URL",
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain(
      'type={field.key === "accessKeySecret" ? "password" : "text"}',
    );
    expect(source).toContain('fetch("/api/admin/settings/aliyun-oss"');
    expect(source).toContain('import { fetchJsonOnce } from "@/lib/client/inflight-json"');
    expect(source).toContain('>("/api/admin/settings/aliyun-oss")');
    expect(source).toContain("保存并立即生效");
    expect(source).toContain("当前生效");
    expect(source).toContain("重新读取");
    expect(source).not.toContain("MEDIA_STORAGE_DRIVER");
    expect(source).not.toContain("STORAGE_FORCE_OSS");
  });

  it("explains what every OSS field expects and where to find it", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "components/admin/AdminAliyunOssSettingsSection.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("填写前先准备");
    expect(source).toContain("OSS 控制台 → Bucket → 概览");
    expect(source).toContain("RAM 访问控制 → 用户 → 认证管理 → AccessKey");
    expect(source).toContain("不要带 https://，也不要包含 Bucket 名称");
    expect(source).toContain("只填存储空间名称，不要填 URL 或目录路径");
    expect(source).toContain("只在创建 AccessKey 时显示一次");
    expect(source).toContain("私有 Bucket 请留空，系统会使用签名 URL");
    expect(source).toContain("{field.hint}");
  });
});
