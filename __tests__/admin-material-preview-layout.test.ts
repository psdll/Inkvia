import { readChineseUiSource } from "./helpers/chinese-ui-source";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("admin material preview responsive layout", () => {
  const root = process.cwd();
  const lightboxSource = readChineseUiSource(
    path.join(root, "components/ui/media-lightbox.tsx"),
    "utf8",
  );
  const adminSource = readChineseUiSource(
    path.join(root, "app/admin/material-assets/page.tsx"),
    "utf8",
  );

  it("keeps image geometry stable while fitting videos to their natural ratio", () => {
    expect(lightboxSource).toContain(
      'layout?: "content" | "material-detail" | "floating"',
    );
    expect(lightboxSource).toContain('layout = "content"');
    expect(lightboxSource).toContain('layout === "material-detail"');
    expect(lightboxSource).toContain("md:h-[86vh]");
    expect(lightboxSource).toContain("md:max-h-[820px]");
    expect(lightboxSource).toContain("md:w-auto");
    expect(lightboxSource).toContain("md:inline-block");
    expect(lightboxSource).toContain("AppVideoPlayer");
    expect(lightboxSource).toContain("videoAspectRatio");
    expect(lightboxSource).toContain("setVideoAspectRatio");
    expect(lightboxSource).toContain("videoAspectRatio >= 4 / 3");
    expect(lightboxSource).toContain("md:h-[72vh] md:max-h-[680px]");
    expect(lightboxSource).toContain("--media-aspect");
    expect(lightboxSource).toContain("onNaturalSize");
    expect(lightboxSource).toContain("md:aspect-[3/4]");
    expect(lightboxSource).toContain("md:w-[300px]");
    expect(lightboxSource).toContain(
      'isMaterialDetailLayout ? "absolute inset-x-0 top-0" : "relative"',
    );
    expect(lightboxSource).toContain(
      'isMaterialDetailLayout ? "pt-[56px]" : ""',
    );
    expect(lightboxSource).toContain(
      '"flex flex-col overflow-hidden md:h-full md:w-fit md:self-start md:flex-row"',
    );
    expect(lightboxSource).not.toMatch(/<video\b[^>]*\bcontrols(?:=|\s|>)/);
    expect(adminSource).toContain('layout="material-detail"');
  });

  it("keeps the administrator edit action and all administrator-only details", () => {
    const start = adminSource.indexOf("function MaterialAssetPreviewDetails");
    const end = adminSource.indexOf("function MaterialAssetEditModal", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const detailsSource = adminSource.slice(start, end);
    expect(detailsSource).toContain("onEdit");
    expect(detailsSource).toContain("编辑");
    expect(detailsSource).toContain("mediaItems.map");
    expect(detailsSource).toContain("onSelectMedia(index)");
    expect(detailsSource).not.toContain("下载当前原图");
    expect(detailsSource).toMatch(/onClick=\{onDownloadCurrent\}(?:(?!<\/button>)[\s\S])*?下载\s*<\/button>/);
    expect(detailsSource).toContain("下载整组 ZIP");
    expect(detailsSource).toContain("onDownloadCurrent");
    expect(detailsSource).toContain("onDownloadSeries");
    expect(adminSource).toContain("/api/admin/material-assets/${assetId}/download");
    expect(adminSource).toContain('params.set("mode", mode)');
    expect(adminSource).toContain('params.set("mediaId", mediaId)');

    for (const label of [
      "标题",
      "ID",
      "分类",
      "状态",
      "制作人",
      "大小",
      "上传时间",
      "下载次数",
      "系列图张数",
      "当前图片",
      "类型",
    ]) {
      expect(detailsSource).toContain(label);
    }
  });
});
