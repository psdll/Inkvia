import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import { normalizeInspirationCategory } from "@/lib/inspiration-category";

vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: () => ({ ok: true, username: "test-admin" }) }));
const integration = process.env.RUN_P0_DB_TESTS === "1" ? it : it.skip;
const prefix = `category-test-${randomUUID()}`;
let db: any;
async function client() { return db ||= (await import("@/lib/prisma")).default; }
function request(form: FormData, url = "http://localhost/api/admin/settings/inspiration-templates") {
  return new NextRequest(url, { method: "POST", body: form });
}
afterAll(async () => {
  if (!db) return;
  const records = await db.template.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } });
  await db.appSetting.deleteMany({ where: { key: { in: records.map((row: any) => `inspiration_template_meta_${row.id}`) } } });
  await db.template.deleteMany({ where: { title: { startsWith: prefix } } });
  await db.$disconnect();
});

describe("custom inspiration categories", () => {
  it("preserves display names and supports archives without categories", () => {
    expect(normalizeInspirationCategory("  产品摄影 & 电商  ")).toBe("产品摄影 & 电商");
    expect(normalizeInspirationCategory(undefined)).toBeNull();
    expect(normalizeInspirationCategory("  ")).toBeNull();
    expect(normalizeInspirationCategory("all")).toBe("all");
    expect(() => normalizeInspirationCategory("a".repeat(41))).toThrow();
    expect(() => normalizeInspirationCategory({ name: "invalid" })).toThrow();
  });

  integration("saves custom names, lists categories beyond page one, and filters independently of tools", async () => {
    await client();
    const { POST } = await import("@/app/api/admin/settings/inspiration-templates/route");
    const { GET } = await import("@/app/api/templates/route");
    const names = [`${prefix}-产品摄影`, `${prefix}-品牌 & 视频`];
    // API max length includes prefix, so fixtures use unique shorter category names.
    names[0] = `摄影-${prefix.slice(-8)}`; names[1] = `品牌 & 视频-${prefix.slice(-8)}`;
    for (const [index, name] of [...names, names[0]].entries()) {
      const form = new FormData();
      form.set("title", `${prefix}-${index}`); form.set("prompt", "synthetic");
      form.set("category", ` ${name} `); form.set("toolType", index === 0 ? "image" : "video"); form.set("mediaType", "image");
      const response = await POST(request(form));
      expect(response.status).toBe(200);
      expect((await response.json()).data.category).toBe(name);
    }
    const page = await (await GET(new NextRequest("http://localhost/api/templates?mode=card&take=1"))).json();
    expect(page.meta.categories).toEqual(expect.arrayContaining(names));
    expect(page.meta.categories.filter((name: string) => name === names[0])).toHaveLength(1);
    const filtered = await (await GET(new NextRequest(`http://localhost/api/templates?mode=card&take=24&category=${encodeURIComponent(names[0])}`))).json();
    expect(filtered.meta.total).toBe(2);
    expect(filtered.data.map((item: any) => item.toolType).sort()).toEqual(["image", "video"]);
    expect(filtered.data.every((item: any) => item.category === names[0])).toBe(true);
  }, 30000);

  integration("retains the custom category through template package export and import", async () => {
    const p = await client();
    const { buildSingleTemplatePackageBufferById } = await import("@/app/api/admin/settings/inspiration-templates/_package");
    const { POST } = await import("@/app/api/admin/settings/inspiration-templates/import/route");
    const source = await p.template.create({ data: { title: `${prefix}-archive`, prompt: "fixture", category: "自定义分类", toolType: "image", mediaType: "image" } });
    const exported = await buildSingleTemplatePackageBufferById(source.id);
    const zip = await JSZip.loadAsync(exported.buffer);
    expect(JSON.parse(await zip.file("template.json")!.async("string")).template.category).toBe("自定义分类");
    const form = new FormData();
    form.set("package", new Blob([Uint8Array.from(exported.buffer)], { type: "application/zip" }), "fixture.template.zip");
    const response = await POST(request(form));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect((await p.template.findUniqueOrThrow({ where: { id: body.data.id } })).category).toBe("自定义分类");
  }, 30000);
});
