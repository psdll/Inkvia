import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";
import { writeBundleInputs } from "./third-party-notices.mjs";

const root = fs.realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const nextDir = path.join(root, ".next");
const standalone = path.join(nextDir, "standalone");
const inventoryDir = process.env.INKVIA_LICENSE_INVENTORY_DIR;
if (process.env.INKVIA_LOCAL_PRODUCTION) throw new Error("请取消设置 INKVIA_LOCAL_PRODUCTION");
const env = { ...process.env, __NEXT_PROCESSED_ENV: "true", NEXT_DIST_DIR: ".next", NEXT_TELEMETRY_DISABLED: "1" };
const win = process.platform === "win32";
execFileSync("npm", ["run", "build"], { cwd: root, env, stdio: "inherit", shell: win });
if (inventoryDir) {
  for (const name of fs.readdirSync(nextDir).filter((file) => /^webpack-license-.*\.json$/.test(file))) {
    fs.renameSync(path.join(nextDir, name), path.join(inventoryDir, name));
  }
}
for (const name of fs.readdirSync(standalone)) {
  if (/^\.env(?:\.|$)/.test(name)) fs.unlinkSync(path.join(standalone, name));
}
fs.cpSync(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
  filter: source => source !== path.join(root, "public/uploads"),
});
fs.mkdirSync(path.join(standalone, "scripts"), { recursive: true });
fs.copyFileSync(path.join(root, "desktop/lib/worker-control.cjs"), path.join(standalone, "scripts/desktop-worker-control.cjs"));
for (const name of ["image-batch-worker", "live-video-batch-worker", "canvas-worker"]) {
  const result = buildSync({
    absWorkingDir: root,
    entryPoints: [path.join("scripts", name + ".ts")],
    outfile: path.join(standalone, "scripts", name + ".mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    conditions: ["react-server", "node"],
    external: ["@next/env", "@prisma/client", "sharp", "proxy-agent"],
    banner: { js: [
      'import { createRequire as __aiCreateRequire } from "node:module";',
      'import { fileURLToPath as __aiFileURLToPath } from "node:url";',
      'import { dirname as __aiDirname } from "node:path";',
      "const require = __aiCreateRequire(import.meta.url);",
      "const __filename = __aiFileURLToPath(import.meta.url);",
      "const __dirname = __aiDirname(__filename);",
    ].join("\n") },
    logLevel: "silent",
    metafile: Boolean(inventoryDir),
  });
  if (inventoryDir) writeBundleInputs(inventoryDir, name, root, result.metafile);
}
const localRequire = createRequire(path.join(standalone, "server.js"));
await localRequire("sharp")({ create: { width: 1, height: 1, channels: 3, background: "black" } }).png().toBuffer();
const prismaDir = path.join(standalone, "node_modules/.prisma/client");
const engine = fs.readdirSync(prismaDir).find(name => name.endsWith(".node") && name.includes(win ? "windows" : process.arch === "arm64" ? "darwin-arm64" : "darwin.dylib"));
if (!engine) throw new Error("standalone 缺少当前平台 Prisma 查询引擎");
localRequire(path.join(prismaDir, engine));
console.log("standalone + 3 worker bundles ready; sharp and Prisma engine loaded");
