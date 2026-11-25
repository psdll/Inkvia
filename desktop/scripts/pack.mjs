import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";
import sharp from "sharp";
import { verifyMediaBuild } from "./verify-media-build.mjs";
import { copyPostgres } from "./postgres-runtime.mjs";
import { normalizeStandaloneBuildPaths, verifyInstallerPaths } from "./package-path-privacy.mjs";
import { writeBundleInputs, writePackageNotices } from "./third-party-notices.mjs";
import { runtimePaths } from "../lib/runtime-paths.cjs";

const require = createRequire(import.meta.url);
const p = runtimePaths();
const win = process.platform === "win32";
if ((!win && process.platform !== "darwin") || (win && process.arch !== "x64") ||
    (process.argv[2] && process.argv[2] !== process.platform)) throw Error("请在目标平台及架构上构建");
const pkg = require(path.join(p.root, "package.json"));
const output = path.join(p.root, "dist-desktop");
const suffix = process.platform + "-" + process.arch;
const runtime = path.join(output, "app-runtime-" + suffix), shell = path.join(output, "shell-" + suffix);
const inputDir = path.join(output, "license-inputs-" + suffix);
const icons = path.join(p.root, "desktop", "build");
execFileSync(process.execPath, [path.join(p.root, "desktop/scripts/prepare-media.mjs")], { stdio: "inherit" });
fs.rmSync(inputDir, { recursive: true, force: true });
fs.mkdirSync(inputDir, { recursive: true });
execFileSync("npm", ["run", "desktop:prepare"], {
  cwd: p.root, stdio: "inherit", shell: win,
  env: { ...process.env, INKVIA_LICENSE_INVENTORY_DIR: inputDir },
});
for (const dir of [runtime, shell]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
function copy(from, to) {
  fs.cpSync(from, to, { recursive: true, dereference: true });
}
const standalone = path.join(runtime, ".next", "standalone");
copy(p.runtime, standalone);
normalizeStandaloneBuildPaths(standalone, p.root);
copy(p.probeBootstrap, path.join(runtime, "media-probe-node.cjs"));
for (const name of ["schema.prisma", "migrations"]) copy(path.join(p.root, "prisma", name), path.join(runtime, "prisma", name));
for (const file of ["package.json", "LICENSE", "build/index.js", "build/schema_engine_bg.wasm", "build/prisma_schema_build_bg.wasm"]) {
  const relative = path.join("node_modules", "prisma", file);
  copy(path.join(p.root, relative), path.join(runtime, relative));
}
for (const name of ["@prisma/config", "@prisma/engines"]) {
  const entry = require.resolve(name), relative = path.relative(p.root, entry);
  const result = buildSync({ entryPoints: [entry], outfile: path.join(runtime, relative), platform: "node", bundle: true,
    format: "cjs", target: "node22", logLevel: "error", metafile: true });
  writeBundleInputs(inputDir, name.replace("@", "").replace("/", "-"), p.root, result.metafile);
  const dir = path.join("node_modules", name);
  for (const file of ["package.json", "LICENSE"]) copy(path.join(p.root, dir, file), path.join(runtime, dir, file));
}
copy(p.schemaEngine, path.join(runtime, path.relative(p.root, p.schemaEngine)));
copyPostgres(path.dirname(p.pgBin), path.join(runtime, "postgres"));
for (const source of [p.ffmpeg, p.ffprobe]) {
  const dest = path.join(runtime, "bin", path.basename(source));
  copy(source, dest);
  fs.chmodSync(dest, 0o755);
  verifyMediaBuild(dest);
}

const desktop = path.join(p.root, "desktop");
copy(path.join(desktop, "licenses"), path.join(runtime, "licenses"));
for (const file of fs.readdirSync(desktop).filter(f => /\.(cjs|html|js)$/.test(f) && f !== "electron-builder.cjs")) {
  copy(path.join(desktop, file), path.join(shell, file));
}
copy(path.join(desktop, "lib"), path.join(shell, "lib"));
// Bundle pg's JS dependencies with the shell; the installed shell has no source node_modules.
const postgresBundle = buildSync({ entryPoints: [path.join(desktop, "lib", "postgres.cjs")],
  outfile: path.join(shell, "lib", "postgres.cjs"), bundle: true, platform: "node", target: "node22",
  external: ["pg-native", "./config.cjs"], metafile: true });
writeBundleInputs(inputDir, "desktop-postgres", p.root, postgresBundle.metafile);
writePackageNotices({ root: p.root, runtime, inputDir, postgresPackage: path.dirname(path.dirname(p.pgBin)) });
fs.writeFileSync(path.join(shell, "package.json"), JSON.stringify({
  name: pkg.name, version: pkg.version, main: "main.cjs", description: "Inkvia 墨途桌面客户端", author: "Inkvia",
}));
fs.mkdirSync(icons, { recursive: true });
const png = path.join(icons, "icon.png");
await sharp(path.join(p.root, "public", "brand", "inkvia-icon.svg"), { density: 512 }).resize(1024, 1024).png().toFile(png);
const { runIconsTool } = require("app-builder-lib/out/toolsets/icons");
for (const format of ["icns", "ico"]) await runIconsTool({ inputFile: png, outputFormat: format, outDir: icons });

const { build, Platform, Arch } = require("electron-builder");
const artifacts = await build({ projectDir: p.root, config: require("../electron-builder.cjs"), publish: "never",
  targets: (win ? Platform.WINDOWS : Platform.MAC).createTarget(win ? "nsis" : "dmg", Arch[process.arch]) });
const installers = artifacts.filter(f => /\.(dmg|exe)$/i.test(f));
if (!installers.length) throw Error("没有找到生成的桌面安装包");
for (const file of installers) {
  if (fs.statSync(file).size > 400_000_000) throw Error("安装包超过 400 MB：" + file);
  await verifyInstallerPaths(file, p.root);
}
