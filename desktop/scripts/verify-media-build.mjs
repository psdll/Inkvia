import { execFileSync, spawnSync } from "node:child_process";

export function verifyMediaBuild(binary) {
  if (process.platform === "darwin") {
    const arch = execFileSync("lipo", ["-archs", binary], { encoding: "utf8" }).trim();
    if (arch !== (process.arch === "arm64" ? "arm64" : "x86_64")) throw Error("媒体工具架构不匹配：" + binary);
  }
  const result = spawnSync(binary, ["-hide_banner", "-buildconf"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("读取媒体工具编译参数失败：" + binary);
  const config = result.stdout + "\n" + result.stderr;
  if (config.includes("--enable-nonfree")) throw Error("拒绝打包 --enable-nonfree：" + binary);
  for (const flag of ["--enable-gpl", "--enable-libx264"]) {
    if (!config.split(/\s+/).includes(flag)) throw Error("媒体工具缺少 " + flag + "：" + binary);
  }
}
