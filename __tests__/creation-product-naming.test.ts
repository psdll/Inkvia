import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const RUNTIME_ROOTS = ["app", "components", "lib", "hooks", "config"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);

function runtimeSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

function legacyNameOffenders(legacyName: string): string[] {
  return RUNTIME_ROOTS
    .flatMap(runtimeSourceFiles)
    .filter((path) => readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "").includes(legacyName))
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"));
}

describe("产品命名", () => {
  it("不再在运行时产品文案中显示工具箱旧名称", () => {
    expect(legacyNameOffenders("工具箱")).toEqual([]);
  });

  it.each(["批量工作台", "无限画布"])("不再在运行时产品文案中显示旧名称：%s", (legacyName) => {
    expect(legacyNameOffenders(legacyName)).toEqual([]);
  });
});
