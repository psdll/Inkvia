import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import zh from "@/messages/zh-CN.json";
import en from "@/messages/en.json";

const source = readFileSync(resolve(process.cwd(), "components/history/unified-history-actions.tsx"), "utf8");

function optionLabels(name: "TIME_RANGE_OPTIONS" | "TYPE_FILTER_OPTIONS") {
  const options = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] ?? "";
  expect(source).toContain(`options={${name}.map(({ value, message }) => ({ value, label: text(message) }))}`);
  return [...options.matchAll(/\{ value: "([^"]+)", message: "createDynamic\.([^"]+)" \}/g)].map(([, value, id]) => {
    const key = id as keyof typeof zh.createDynamic;
    return [value, zh.createDynamic[key], en.createDynamic[key]];
  });
}

describe("unified history filter labels", () => {
  it("keeps time and type filter options in Chinese", () => {
    expect(optionLabels("TIME_RANGE_OPTIONS")).toEqual([
      ["all", "全部时间", "All time"],
      ["1d", "今天", "Today"],
      ["7d", "最近一周", "Past week"],
      ["15d", "最近15天", "Past 15 days"],
    ]);
    expect(optionLabels("TYPE_FILTER_OPTIONS")).toEqual([
      ["all", "全部类型", "All types"],
      ["face_swap", "人脸", "Face"],
      ["image_edit", "图片", "Image"],
      ["video", "视频", "Video"],
    ]);
  });

  it("gives both compact filter dropdowns enough width for full Chinese labels", () => {
    expect(source.match(/className=\{isCompact \? "w-\[120px\]" : "w-\[126px\]"\}/g)).toHaveLength(2);
  });
});
