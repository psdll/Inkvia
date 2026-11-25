import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import zh from "@/messages/zh-CN.json";
import en from "@/messages/en.json";

const language = vi.hoisted(() => ({ current: "zh-CN" as "zh-CN" | "en" }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "common") => ({
    raw: (key: keyof typeof zh.common) => (language.current === "en" ? en : zh)[namespace][key],
  }),
}));

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const logoSource = read("components/ui/BrandLogo.tsx");
const homeSource = read("components/home/home-page-client.tsx");
const sidebarSource = read("components/layout/workspace-sidebar.tsx");
const topNavSource = read("components/layout/top-nav.tsx");
const legacySidebarSource = read("components/layout/sidebar.tsx");
const appLayoutSource = read("app/layout.tsx");

describe("Inkvia brand", () => {
  it("draws the path mark inline so it does not depend on image assets", () => {
    expect(logoSource).toContain('variant?: "mark" | "wordmark";');
    expect(logoSource).toContain('d="M21 30V40Q21 50 31 50H43"');
    expect(logoSource).toContain('aria-hidden="true"');
    expect(logoSource).toContain(">Inkvia</span>");
    expect(logoSource).not.toContain("/brand/");
  });

  it("ships a square favicon and the source marks", async () => {
    const { width, height } = await sharp(resolve(process.cwd(), "public/favicon.png")).metadata();
    expect(width).toBe(256);
    expect(height).toBe(256);
    expect(existsSync(resolve(process.cwd(), "public/brand/inkvia-mark.svg"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "public/brand/inkvia-icon.svg"))).toBe(true);
    const renderedIcon = await sharp(Buffer.from(read("public/brand/inkvia-icon.svg"))).resize(256, 256).raw().toBuffer();
    const favicon = await sharp(resolve(process.cwd(), "public/favicon.png")).raw().toBuffer();
    expect(favicon.equals(renderedIcon)).toBe(true);
  });

  it("uses the wordmark at home and the compact mark elsewhere", () => {
    expect(homeSource).toContain('<BrandLogo variant="wordmark" size={100}');
    expect(sidebarSource).toContain("<BrandLogo size={30}");
    expect(topNavSource).toContain("<BrandLogo size={24}");
    expect(legacySidebarSource).toContain("<BrandLogo size={24}");
    expect(topNavSource).toContain(">Inkvia</span>");
    expect(topNavSource).toContain("Inkvia v1.0");
    expect(legacySidebarSource).toContain("Inkvia");
  });

  it("publishes Inkvia metadata", async () => {
    const { generateMetadata } = await import("@/app/layout");
    expect(await generateMetadata()).toEqual({
      title: "Inkvia 墨途",
      description: "AI 图像、视频与设计创作平台",
      icons: { icon: "/favicon.png" },
    });
    language.current = "en";
    try {
      expect(await generateMetadata()).toEqual({
        title: en.common.pageTitle,
        description: en.common.pageDescription,
        icons: { icon: "/favicon.png" },
      });
    } finally {
      language.current = "zh-CN";
    }
  });

  it("leaves no old product name in product code", () => {
    for (const source of [logoSource, homeSource, topNavSource, legacySidebarSource, appLayoutSource]) {
      expect(source).not.toMatch(/mivo/i);
    }
  });
});
