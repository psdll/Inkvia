import fs from "fs";
import path from "path";

function parseEnv(content) {
  const out = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const idx = s.indexOf("=");
    if (idx <= 0) continue;
    const key = s.slice(0, idx).trim();
    let val = s.slice(idx + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!key) continue;
    out[key] = val;
  }
  return out;
}

function normalizeDir(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return path.resolve(s);
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function rootCandidates() {
  const cwd = normalizeDir(process.cwd());
  const initCwd = normalizeDir(process.env.INIT_CWD);
  const pwd = normalizeDir(process.env.PWD);
  const appRoot = normalizeDir(process.env.APP_ROOT_DIR);
  const argvEntry = normalizeDir(process.argv[1] ? path.dirname(process.argv[1]) : "");
  return unique([
    appRoot,
    cwd,
    argvEntry,
    path.resolve(argvEntry, ".."),
    path.resolve(argvEntry, "..", ".."),
    initCwd,
    pwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "..", "..")
  ]);
}

function resolveProjectRoot() {
  for (const root of rootCandidates()) {
    if (
      fs.existsSync(path.join(root, "package.json")) &&
      fs.existsSync(path.join(root, "public")) &&
      (fs.existsSync(path.join(root, "app")) || fs.existsSync(path.join(root, "next.config.js")))
    ) {
      return root;
    }
  }
  return process.cwd();
}

function assertPathExists(p, label, errors) {
  if (!fs.existsSync(p)) errors.push(`${label} 不存在: ${p}`);
}

function assertDirWritable(p, label, errors) {
  try {
    fs.mkdirSync(p, { recursive: true });
    fs.accessSync(p, fs.constants.W_OK);
  } catch {
    errors.push(`${label} 不可写: ${p}`);
  }
}

const root = resolveProjectRoot();
const envFile = path.join(root, ".env.local");
const prismaDb = path.join(root, "prisma", "dev.db");
const uploadsRoot = path.join(root, "public", "uploads");
const presetsRoot = path.join(uploadsRoot, "presets");
const builtinRoot = path.join(presetsRoot, "_builtin");

const errors = [];
const warnings = [];

assertPathExists(path.join(root, "package.json"), "package.json", errors);
assertPathExists(path.join(root, "prisma", "schema.prisma"), "prisma schema", errors);
assertPathExists(path.join(root, "public"), "public 目录", errors);
assertPathExists(envFile, ".env.local", errors);

let envData = {};
if (fs.existsSync(envFile)) {
  envData = parseEnv(fs.readFileSync(envFile, "utf8"));
}

const requiredKeys = [
  "ADMIN_PASSWORD",
  "ADMIN_SECRET"
];

for (const key of requiredKeys) {
  const val = String(envData[key] || process.env[key] || "").trim();
  if (!val) errors.push(`缺少环境变量: ${key}`);
}

if (!fs.existsSync(prismaDb)) {
  warnings.push(`未找到现有数据库文件: ${prismaDb}`);
}

assertDirWritable(uploadsRoot, "uploads 目录", errors);
assertDirWritable(presetsRoot, "presets 目录", errors);
assertDirWritable(builtinRoot, "builtin presets 目录", errors);

console.log(`项目根目录: ${root}`);
console.log(`环境文件: ${envFile}`);
console.log(`数据库文件: ${prismaDb}`);
console.log(`上传目录: ${uploadsRoot}`);

if (warnings.length) {
  console.log("\n警告:");
  for (const w of warnings) console.log(`- ${w}`);
}

if (errors.length) {
  console.log("\n失败项:");
  for (const e of errors) console.log(`- ${e}`);
  process.exit(1);
}

console.log("\n部署前检查通过");
