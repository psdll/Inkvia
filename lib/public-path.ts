import fs from "fs";
import path from "path";

function normalizeDir(v: string | undefined | null) {
  const s = String(v || "").trim();
  if (!s) return "";
  return path.resolve(s);
}

function uniqueDirs(xs: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function hasPublicDir(rootDir: string) {
  if (!rootDir) return false;
  return fs.existsSync(path.join(rootDir, "public"));
}

function hasProjectSignature(rootDir: string) {
  if (!rootDir) return false;
  if (!hasPublicDir(rootDir)) return false;
  const hasPackage = fs.existsSync(path.join(rootDir, "package.json"));
  const hasAppDir = fs.existsSync(path.join(rootDir, "app"));
  const hasNextConfig = fs.existsSync(path.join(rootDir, "next.config.js"));
  return hasPackage && (hasAppDir || hasNextConfig);
}

function buildRootCandidates() {
  const cwd = normalizeDir(process.cwd());
  const initCwd = normalizeDir(process.env.INIT_CWD);
  const pwd = normalizeDir(process.env.PWD);
  const appRoot = normalizeDir(process.env.APP_ROOT_DIR);
  const argvEntry = normalizeDir(process.argv[1] ? path.dirname(process.argv[1]) : "");
  const roots = [
    appRoot,
    cwd,
    argvEntry,
    path.resolve(argvEntry, ".."),
    path.resolve(argvEntry, "..", ".."),
    initCwd,
    pwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "..", "..")
  ];
  return uniqueDirs(roots);
}

let cachedRootDir = "";

export function resolveProjectRootDir() {
  if (cachedRootDir && hasPublicDir(cachedRootDir)) return cachedRootDir;
  const candidates = buildRootCandidates();
  for (const dir of candidates) {
    if (hasProjectSignature(dir)) {
      cachedRootDir = dir;
      return dir;
    }
  }
  for (const dir of candidates) {
    if (hasPublicDir(dir)) {
      cachedRootDir = dir;
      return dir;
    }
  }
  cachedRootDir = normalizeDir(process.cwd());
  return cachedRootDir;
}

export function resolvePublicDir() {
  return path.join(resolveProjectRootDir(), "public");
}

export function resolvePublicPath(...segments: string[]) {
  const publicDir = resolvePublicDir();
  const resolved = path.join(publicDir, ...segments);
  const configuredUploads = normalizeDir(process.env.UPLOADS_DIR);
  if (!configuredUploads) return resolved;

  const relativeToUploads = path.relative(
    path.join(publicDir, "uploads"),
    resolved,
  );
  if (
    relativeToUploads === ""
    || (
      !relativeToUploads.startsWith(`..${path.sep}`)
      && relativeToUploads !== ".."
      && !path.isAbsolute(relativeToUploads)
    )
  ) {
    return path.join(configuredUploads, relativeToUploads);
  }
  return resolved;
}
