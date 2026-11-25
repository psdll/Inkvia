import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";
import { runtimePaths } from "../lib/runtime-paths.cjs";

const macBuilds = {
  arm64: { build: "arm64/1795207104_9.1", ffmpeg: "1f66e9a690a7f1c9e60b012379f8869c11818d1797f45b21dbb2f2564ba61ae1",
    ffprobe: "6ef2df5f575042923a28537ab37adf936f28bf3e7b85de23a1447ed447ec1dbd" },
  x64: { build: "amd64/1795212433_9.1", ffmpeg: "35b3d82cccc2c1d644d49d15f5e57eb913a08ef68f798042c90eecec62c51f1e",
    ffprobe: "41ca7b7cba7992e33f1da3f1bf54db8ec103a4d387b1bfac3162062e8b1074ad" },
};
const tools = ["ffmpeg", "ffprobe"];
function archives() {
  const mac = macBuilds[process.arch];
  if (process.platform === "darwin" && mac) return tools.map(tool => ({
    url: `https://ffmpeg.martin-riedl.de/download/macos/${mac.build}/${tool}.zip`,
    sha256: mac[tool], members: [tool],
  }));
  if (process.platform === "win32" && process.arch === "x64") {
    const release = "autobuild-2026-10-31-12-59";
    const build = "ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-9.0";
    return [{ url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/${release}/${build}.zip`,
      sha256: "693f3e224bc184b40524a62ca47526cfebaf2504414021b92fe75f677ad868b9",
      members: tools.map(tool => `${build}/bin/${tool}.exe`) }];
  }
  throw Error("桌面媒体工具不支持当前平台或架构");
}

const bin = path.dirname(runtimePaths().ffmpeg);
fs.mkdirSync(bin, { recursive: true });
const cache = path.dirname(bin);
const temp = fs.mkdtempSync(path.join(cache, "prepare-"));
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
try {
  for (const { url, sha256, members } of archives()) {
    const archive = path.join(cache, sha256 + ".zip");
    const cached = fs.existsSync(archive);
    const input = cached ? archive : path.join(temp, "download.zip");
    if (!cached) execFileSync(process.platform === "win32" ? "curl.exe" : "curl", [
      "--fail", "--location", "--silent", "--show-error", "--proto", "=https", "--proto-redir", "=https",
      "--retry", "3", "--connect-timeout", "20", "--max-time", "600", "--output", input, url,
    ], { stdio: "inherit" });
    const bytes = fs.readFileSync(input);
    if (digest(bytes) !== sha256) throw Error("媒体工具 SHA-256 不匹配：" + input);
    if (!cached) fs.renameSync(input, archive);
    const zip = await JSZip.loadAsync(bytes);
    for (const member of members) {
      const entry = zip.file(member);
      if (!entry) throw Error("媒体工具归档缺少 " + member);
      const executable = await entry.async("nodebuffer");
      const name = path.basename(member), target = path.join(bin, name);
      if (fs.existsSync(target) && fs.readFileSync(target).equals(executable)) continue;
      const staged = path.join(temp, name);
      fs.writeFileSync(staged, executable, { mode: 0o755 });
      fs.renameSync(staged, target);
    }
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
