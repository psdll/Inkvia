import { describe, expect, it } from "vitest";
import { installBuiltinRoleSkills } from "@/lib/builtin-skills/install";

const liveName = "静态图片转 4 秒 Live Photo";
const productName = "产品AI真实场景图提示词";
const liveMarker = "desktop.seed.live_photo_skill.v1";
const productMarker = "builtin.seed.product_scene_skill.v1";
const liveBinding = "role_skill_binding.batch_workbench.live_video";

type Row = {
  id: bigint;
  name: string;
  content: string;
  status: string;
  mediaType?: string;
  summary?: string;
  deletedAt: Date | null;
};

function fixture(rows: Row[] = [], settings: Record<string, string> = {}) {
  const marks = new Map(Object.entries(settings));
  let nextId = BigInt(10);
  const tx = {
    appSetting: {
      createMany: async ({ data }: { data: { key: string; value: string } }) => {
        if (marks.has(data.key)) return { count: 0 };
        marks.set(data.key, data.value);
        return { count: 1 };
      },
    },
    systemRoleSkill: {
      findFirst: async ({ where }: { where: { OR: Array<{ name?: string; content?: string }> } }) =>
        rows.find(row => where.OR.some(term => row.name === term.name || row.content === term.content)) ?? null,
      create: async ({ data }: { data: Omit<Row, "id" | "deletedAt"> }) => {
        const row = { ...data, id: nextId++, deletedAt: null };
        rows.push(row);
        return row;
      },
    },
  };
  const db = { ...tx, $transaction: (operation: (client: typeof tx) => Promise<void>) => operation(tx) };
  return { rows, marks, install: () => installBuiltinRoleSkills(db as unknown as Parameters<typeof installBuiltinRoleSkills>[0]) };
}

describe("built-in role skills on startup", () => {
  it("publishes both official skills and binds Live Video to Live Photo on a fresh database", async () => {
    const { rows, marks, install } = fixture();
    await install();
    expect(rows.map(row => [row.name, row.status, row.mediaType])).toEqual([
      [liveName, "published", "image"],
      [productName, "published", "image"],
    ]);
    expect(rows[0].content).toContain("4秒苹果原相机 Live Photo 视频提示词生成系统");
    expect(rows[1].content).toContain("高产品还原度的真实生活纪实型AI商业视觉");
    expect(rows[1].summary).toMatch(/图片生成提示词。$/);
    expect(marks.get(liveMarker)).toBe("1");
    expect(marks.get(productMarker)).toBe("1");
    expect(JSON.parse(marks.get(liveBinding)!)).toEqual({ version: 1, skillPublicId: "system:10" });
  });

  it("keeps record IDs on repeated startup and does not re-create deleted or unbound entries", async () => {
    const { rows, marks, install } = fixture();
    await install();
    await install();
    expect(rows.map(row => row.id)).toEqual([BigInt(10), BigInt(11)]);
    rows.length = 0;
    marks.delete(liveBinding);
    await install();
    expect(rows).toEqual([]);
    expect(marks.has(liveBinding)).toBe(false);
  });

  it("deduplicates an existing same-name skill without changing the original", async () => {
    const own = { id: BigInt(3), name: productName, content: "用户自己的版本", status: "published", deletedAt: null };
    const { rows, marks, install } = fixture([own]);
    await install();
    expect(rows.filter(row => row.name === productName)).toEqual([own]);
    expect(marks.get(productMarker)).toBe("1");
  });

  it("marks a copy under another name as already installed without restoring a deleted row", async () => {
    const originals = fixture();
    await originals.install();
    const removed = { ...originals.rows[0], name: "旧 Live Photo", status: "hidden", deletedAt: new Date() };
    const { rows, marks, install } = fixture([removed]);
    await install();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(removed);
    expect(marks.has(liveBinding)).toBe(false);
  });

  it("preserves a pre-existing custom Live Video binding", async () => {
    const existingBinding = JSON.stringify({ version: 1, skillPublicId: "system:2" });
    const { marks, install } = fixture([], { [liveBinding]: existingBinding });
    await install();
    expect(marks.get(liveBinding)).toBe(existingBinding);
  });

  it("honors the desktop Live Photo seed marker from previous versions without re-binding", async () => {
    const { rows, marks, install } = fixture([], { [liveMarker]: "1" });
    await install();
    expect(rows.map(row => row.name)).toEqual([productName]);
    expect(marks.has(liveBinding)).toBe(false);
  });
});
