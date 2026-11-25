import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import JSZip from "jszip";
import { build, Platform, Arch } from "electron-builder";
import { createRequire } from "node:module";
import { copyPostgres } from "./postgres-runtime.mjs";
import { verifyInstallerPaths } from "./package-path-privacy.mjs";
import { writePackageNotices } from "./third-party-notices.mjs";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw Error("Windows 交叉打包需要 Apple 芯片 Mac");
}
const root = fs.realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(import.meta.url);
const dist = path.join(root, "dist-desktop");
const cache = path.join(dist, "cache/win32-x64/dl");
const runtime = path.join(dist, "app-runtime-win32-x64");
const shell = path.join(dist, "shell-win32-x64");
const output = path.join(dist, "win-out");
const config = require("../electron-builder.cjs");
const pkg = require("../../package.json");
const lock = require("../../package-lock.json").packages;
const macRuntime = path.join(dist, "app-runtime-darwin-arm64");
const macShell = path.join(dist, "shell-darwin-arm64");
if (!fs.existsSync(macRuntime) || !fs.existsSync(macShell)) {
  throw Error("缺少 Mac staging，请先运行 npm run desktop:dist:mac");
}
if (JSON.parse(fs.readFileSync(path.join(macShell, "package.json"), "utf8")).version !== pkg.version) {
  throw Error("Mac staging 版本不符，请先重新打 Mac 包");
}
fs.mkdirSync(cache, { recursive: true });
const scratch = fs.mkdtempSync(path.join(cache, "assemble-"));

function sha256(hex) {
  return { algorithm: "sha256", encoding: "hex", digest: hex };
}

async function matches(file, { algorithm, encoding, digest }) {
  if (!fs.existsSync(file)) return false;
  const hash = createHash(algorithm);
  for await (const block of fs.createReadStream(file)) hash.update(block);
  return hash.digest(encoding) === digest;
}

async function cachedArtifact(name, checksum, produce) {
  const file = path.join(cache, name);
  if (await matches(file, checksum)) return file;
  const staged = path.join(scratch, randomUUID());
  await produce(staged);
  if (!await matches(staged, checksum)) throw Error("校验失败：" + name);
  fs.renameSync(staged, file);
  return file;
}

function download(url, file) {
  execFileSync("curl", ["--fail", "--location", "--silent", "--show-error", "--proto", "=https",
    "--proto-redir", "=https", "--retry", "2", "--connect-timeout", "20", "--max-time", "600",
    "--output", file, url], { stdio: "inherit" });
}

async function extractNpm(name, destination) {
  const { resolved, integrity, version } = lock["node_modules/" + name];
  const [algorithm, digest] = integrity.split("-");
  const archiveName = name.slice(1).replace("/", "-") + "-" + version + ".tgz";
  const archive = await cachedArtifact(archiveName, { algorithm, encoding: "base64", digest },
    file => download(resolved, file));
  fs.mkdirSync(destination);
  execFileSync("tar", ["-xzf", archive, "-C", destination, "--strip-components", "1"]);
}

const prismaCommit = "c2990dca591cba766e3b7ef5d9e8a84796e47ab7";
async function prismaEngine(name, hash) {
  return cachedArtifact(name, sha256(hash), async file => {
    const compressed = file + ".gz";
    download(`https://binaries.prisma.sh/all_commits/${prismaCommit}/windows/${name}.gz`, compressed);
    await pipeline(fs.createReadStream(compressed), createGunzip(), fs.createWriteStream(file));
  });
}

function replaceTree(from, to) {
  fs.rmSync(to, { force: true, recursive: true });
  fs.cpSync(from, to, { dereference: true, recursive: true });
}

function assertWindowsRuntime(dir) {
  const required = [
    ".next/standalone/server.js", "media-probe-node.cjs", "node_modules/prisma/build/index.js", "prisma/schema.prisma",
    "node_modules/@prisma/engines/schema-engine-windows.exe",
    ".next/standalone/node_modules/.prisma/client/query_engine-windows.dll.node",
    ".next/standalone/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node",
    "postgres/bin/initdb.exe", "postgres/bin/postgres.exe", "postgres/bin/pg_ctl.exe", "bin/ffmpeg.exe", "bin/ffprobe.exe",
  ];
  for (const rel of required) {
    if (!fs.statSync(path.join(dir, rel)).size) throw Error("缺少 Windows 运行时文件：" + rel);
  }
  const magic = Buffer.alloc(4);
  const machO = new Set(["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);
  for (const file of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const name = path.join(file.parentPath, file.name);
    const fd = fs.openSync(name, "r");
    try {
      if (fs.readSync(fd, magic, 0, 4, 0) === 4 && machO.has(magic.subarray(0, 4).toString("hex"))) {
        throw Error("Windows 运行时仍包含 Mach-O：" + name);
      }
    } finally { fs.closeSync(fd); }
  }
}

try {
  if (require("@prisma/engines-version").enginesVersion !== prismaCommit) {
    throw Error("Prisma 引擎版本已变更，请重新固定 Windows 引擎的 SHA-256");
  }
  const ffRelease = "autobuild-2026-10-31-12-59";
  const ffBuild = "ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-9.0";
  const ffZip = await cachedArtifact("ffmpeg-win.zip", sha256("693f3e224bc184b40524a62ca47526cfebaf2504414021b92fe75f677ad868b9"),
    file => download(`https://github.com/BtbN/FFmpeg-Builds/releases/download/${ffRelease}/${ffBuild}.zip`, file));
  const vcRedist = await cachedArtifact("vc_redist.x64.exe", sha256("cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b"),
    file => download("https://download.visualstudio.microsoft.com/download/pr/e9604e21-4b79-4096-a4b3-1b63d4b55b4d/CC0FF0EB1DC3F5188AE6300FAEF32BF5BEEBA4BDD6E8E445A9184072096B713B/VC_redist.x64.exe", file));
  const schemaEngine = await prismaEngine("schema-engine.exe", "f2b48e3ce8de8712c9dce6c71f952bec383fa472830b91bca8e64b4b51bf0dd7");
  const queryEngine = await prismaEngine("query_engine.dll.node", "263946105f428384d2318dc3241b85b1c3dd98fbb1bfac62d3e81f513ab35897");

  replaceTree(macRuntime, runtime);
  replaceTree(macShell, shell);
  const bin = path.join(runtime, "bin");
  fs.rmSync(bin, { recursive: true });
  fs.mkdirSync(bin);
  const ffmpeg = await JSZip.loadAsync(fs.readFileSync(ffZip));
  for (const tool of ["ffmpeg.exe", "ffprobe.exe"]) {
    const member = ffmpeg.file(`${ffBuild}/bin/${tool}`);
    if (!member) throw Error("缺少 Windows 媒体工具：" + tool);
    fs.writeFileSync(path.join(bin, tool), await member.async("nodebuffer"));
  }
  const engines = path.join(runtime, "node_modules/@prisma/engines");
  const standaloneModules = path.join(runtime, ".next/standalone/node_modules");
  const client = path.join(standaloneModules, ".prisma/client");
  fs.rmSync(path.join(engines, "schema-engine-darwin-arm64"));
  fs.rmSync(path.join(client, "libquery_engine-darwin-arm64.dylib.node"));
  fs.copyFileSync(schemaEngine, path.join(engines, "schema-engine-windows.exe"));
  fs.copyFileSync(queryEngine, path.join(client, "query_engine-windows.dll.node"));
  const img = path.join(standaloneModules, "@img");
  for (const name of ["sharp-darwin-arm64", "sharp-libvips-darwin-arm64"]) {
    fs.rmSync(path.join(img, name), { recursive: true, force: true });
  }
  await extractNpm("@img/sharp-win32-x64", path.join(img, "sharp-win32-x64"));
  const pg = path.join(scratch, "postgres");
  await extractNpm("@embedded-postgres/windows-x64", pg);
  fs.rmSync(path.join(runtime, "postgres"), { recursive: true });
  copyPostgres(path.join(pg, "native"), path.join(runtime, "postgres"), "win32");
  assertWindowsRuntime(runtime);
  writePackageNotices({
    root, runtime, inputDir: path.join(dist, "license-inputs-darwin-arm64"), postgresPackage: pg, cross: true,
  });

  const { electronDist: _macDist, ...sharedConfig } = config;
  process.env.INKVIA_VC_REDIST_FILE = vcRedist;
  const staging = "dist-desktop/app-runtime-win32-x64";
  const artifacts = await build({
    projectDir: root, publish: "never", targets: Platform.WINDOWS.createTarget("nsis", Arch.x64),
    config: {
      ...sharedConfig,
      directories: { ...config.directories, app: shell, output },
      npmRebuild: false,
      files: ["**/*", "!node_modules{,/**/*}"],
      extraResources: [
        { from: staging, to: "app-runtime", filter: ["**/*", "!node_modules/**"] },
        { from: staging + "/node_modules", to: "app-runtime/node_modules" },
      ],
      nsis: { ...config.nsis, include: path.join(root, "desktop/scripts/vcredist.nsh") },
    },
  });
  const exe = artifacts.find(file => file.endsWith("-setup.exe"));
  if (!exe || fs.statSync(exe).size > 400_000_000) throw Error("Windows 安装包缺失或超过 400 MB");
  const resources = path.join(output, "win-unpacked/resources");
  assertWindowsRuntime(path.join(resources, "app-runtime"));
  const asarSize = fs.statSync(path.join(resources, "app.asar")).size;
  if (asarSize > 512_000) throw Error("Windows app.asar 包含非预期文件");
  await verifyInstallerPaths(exe, root);
  console.log(exe, fs.statSync(exe).size, "bytes, app.asar:", asarSize, "bytes");
} finally {
  fs.rmSync(scratch, { force: true, recursive: true });
}
