const fs = require("node:fs");
const path = require("node:path");

function runtimePaths(packaged = false) {
  const root = fs.realpathSync(packaged ? path.join(process.resourcesPath, "app-runtime") : path.join(__dirname, "../.."));
  const modules = path.join(root, "node_modules");
  const win = process.platform === "win32";
  const suffix = win ? ".exe" : "";
  const target = process.platform + "-" + process.arch;
  const mediaBin = packaged ? path.join(root, "bin") : path.join(root, "dist-desktop", "cache", target, "bin");
  const pgPackage = (win ? "windows" : process.platform) + "-" + process.arch;
  const pgNative = packaged ? path.join(root, "postgres") : path.join(modules, "@embedded-postgres", pgPackage, "native");
  const runtime = path.join(root, ".next", "standalone");
  const prismaTarget = win ? "windows" : process.arch === "arm64" ? "darwin-arm64" : "darwin";
  return {
    root, runtime, pgBin: path.join(pgNative, "bin"),
    probeBootstrap: path.join(packaged ? root : __dirname, "media-probe-node.cjs"),
    prismaCli: path.join(modules, "prisma", "build", "index.js"), schema: path.join(root, "prisma", "schema.prisma"),
    schemaEngine: path.join(modules, "@prisma", "engines", "schema-engine-" + prismaTarget + suffix),
    queryEngine: path.join(runtime, "node_modules", ".prisma", "client", win ? "query_engine-windows.dll.node" : "libquery_engine-" + prismaTarget + ".dylib.node"),
    ffmpeg: path.join(mediaBin, "ffmpeg" + suffix),
    ffprobe: path.join(mediaBin, "ffprobe" + suffix),
  };
}
module.exports = { runtimePaths };
