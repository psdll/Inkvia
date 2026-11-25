import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const neutralRoot = "/inkvia-build";
const generatedText = /\.(?:[cm]?js|json|map|css|html)$/i;

function pathForms(value) {
  const forms = new Set();
  for (const spelling of [value.normalize("NFC"), value.normalize("NFD")]) {
    const forward = spelling.replaceAll("\\", "/");
    const url = forward.split("/").map(part => /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join("/");
    for (const form of [spelling, forward, url]) {
      forms.add(form);
      forms.add(JSON.stringify(form).slice(1, -1));
      forms.add(form.replace(/[^\x00-\x7f]/g, ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")));
    }
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, visit);
    else if (entry.isFile() || entry.isSymbolicLink()) visit(file, entry);
  }
}

export function normalizeStandaloneBuildPaths(standalone, root) {
  const forms = pathForms(root);
  const sanitize = (file, entry) => {
    if ((entry && !entry.isFile()) || !generatedText.test(file)) return;
    const body = fs.readFileSync(file, "utf8");
    let sanitized = body;
    for (const form of forms) {
      // Next carries the same module IDs in the server bundle and in its client-reference manifests.
      const replacement = /^[a-z]:/i.test(form) ? "C:" + neutralRoot : neutralRoot;
      sanitized = sanitized.replaceAll(form, replacement);
    }
    if (sanitized !== body) fs.writeFileSync(file, sanitized);
  };
  sanitize(path.join(standalone, "server.js"));
  walk(path.join(standalone, ".next"), sanitize);
  walk(path.join(standalone, "node_modules", ".prisma", "client"), sanitize);
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function packagePathScanner({ root, home = os.homedir(), username = os.userInfo().username }) {
  const userNames = [...new Set([username, path.basename(home)])].filter(Boolean);
  const profiles = userNames.flatMap(name => [`/Users/${name}`, `/home/${name}`, `\\Users\\${name}`]);
  const forms = new Set([root, home, ...profiles].filter(Boolean).flatMap(pathForms));
  const markers = [...forms].flatMap(form => [
    Buffer.from(form),
    Buffer.from(form, "utf16le"),
  ]);
  const userIdentity = userNames.length
    ? new RegExp(`\\b(?:buildUser|buildOwner|userName|user|author|owner)["']?\\s*[:=]\\s*["']?(?:${userNames.map(escapedRegExp).join("|")})(?=["'\\s,;}]|$)`, "iu")
    : null;
  return function scan(directory) {
    walk(directory, (file, entry) => {
      const relative = path.relative(directory, file);
      const data = entry.isSymbolicLink() ? Buffer.from(fs.readlinkSync(file)) : fs.readFileSync(file);
      if (markers.some(marker => data.includes(marker)) ||
          (userIdentity && generatedText.test(file) && userIdentity.test(data.toString("utf8")))) {
        throw new Error("安装包内发现本机用户名或构建路径：" + relative);
      }
    });
  };
}

function scanWithAsar(directory, scan, scratch) {
  const { extractAll } = require("@electron/asar");
  scan(directory);
  walk(directory, (file, entry) => {
    if (!entry.isFile() || !file.endsWith(".asar")) return;
    const extracted = fs.mkdtempSync(path.join(scratch, "asar-"));
    extractAll(file, extracted);
    scan(extracted);
  });
}

export async function verifyInstallerPaths(artifact, root) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "inkvia-package-check-"));
  const scan = packagePathScanner({ root });
  try {
    if (artifact.toLowerCase().endsWith(".dmg")) {
      const mounted = path.join(scratch, "volume");
      fs.mkdirSync(mounted);
      execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mounted, artifact]);
      try {
        scanWithAsar(mounted, scan, scratch);
      } finally {
        execFileSync("hdiutil", ["detach", mounted]);
      }
    } else if (artifact.toLowerCase().endsWith(".exe")) {
      const { getPath7za } = require("app-builder-lib/out/toolsets/7zip");
      const unzip = await getPath7za();
      const installer = path.join(scratch, "nsis");
      execFileSync(unzip, ["x", "-y", "-o" + installer, artifact]);
      scanWithAsar(installer, scan, scratch);
      const archives = [];
      walk(installer, (file, entry) => {
        if (entry.isFile() && /^app-.*\.7z$/i.test(entry.name)) archives.push(file);
      });
      if (!archives.length) throw new Error("无法核验 Windows 安装包：没有找到 NSIS 应用归档");
      for (const archive of archives) {
        const extracted = fs.mkdtempSync(path.join(scratch, "nsis-app-"));
        execFileSync(unzip, ["x", "-y", "-o" + extracted, archive]);
        if (!fs.existsSync(path.join(extracted, "resources", "app.asar"))) {
          throw new Error("无法核验 Windows 安装包：解包后没有找到应用内容");
        }
        scanWithAsar(extracted, scan, scratch);
      }
    } else {
      throw new Error("无法核验未知安装包类型：" + path.basename(artifact));
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
