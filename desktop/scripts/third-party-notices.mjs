import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const noticesName = "THIRD_PARTY_NOTICES.txt";
const dependencyFile = /^(?:licen[cs]es?|copying|copyright|notices?)(?:$|[._-])/i;
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const slash = (name) => name.split(path.sep).join("/");
const postgresVersion = "16.16";
const postgresCopyright = "PostgreSQL-" + postgresVersion + "-COPYRIGHT.txt";

function manifest(root) {
  const file = path.join(root, "package.json");
  return fs.existsSync(file) ? readJson(file) : undefined;
}

function packageRoot(project, resource) {
  const relative = path.relative(project, path.resolve(project, resource.split("?")[0]));
  if (path.isAbsolute(relative) || relative.startsWith(".." + path.sep)) return undefined;
  const parts = relative.split(path.sep);
  const modules = parts.lastIndexOf("node_modules");
  if (modules < 0 || !parts[modules + 1]) return undefined;
  if (parts[modules + 1] === ".prisma") return undefined;
  const end = modules + (parts[modules + 1].startsWith("@") ? 3 : 2);
  const base = parts.slice(0, end).join(path.sep);
  if (parts[end] === "dist" && parts[end + 1] === "compiled" && parts[end - 1] === "next") {
    for (let length = parts.length - 1; length > end + 2; length--) {
      const candidate = parts.slice(0, length).join(path.sep);
      if (manifest(path.join(project, candidate))) return slash(candidate);
    }
  }
  return manifest(path.join(project, base)) ? slash(base) : undefined;
}

export function writeBundleInputs(directory, name, project, metafile) {
  const packages = Object.entries(metafile.outputs).flatMap(([, output]) => {
    return Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([file]) => {
      return packageRoot(project, file);
    });
  });
  fs.writeFileSync(path.join(directory, name + ".json"), JSON.stringify([...new Set(packages.filter(Boolean))].sort(compare)));
}

function licenseFiles(directory, declared) {
  if (!fs.existsSync(directory)) return [];
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && dependencyFile.test(entry.name))
    .map((entry) => entry.name);
  const explicit = /^SEE LICEN[CS]E IN (.+)$/i.exec(declared)?.[1];
  if (explicit && !path.isAbsolute(explicit) && !explicit.split(/[\\/]/).includes("..")) {
    try {
      if (fs.statSync(path.join(directory, explicit)).isFile()) files.push(explicit);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return [...new Set(files)].sort(compare).map((name) => {
    return { name, text: fs.readFileSync(path.join(directory, name), "utf8") };
  }).filter(({ text }) => text.trim());
}

function npmManifest(project, item, directory, upstream) {
  const data = manifest(directory) ?? manifest(upstream);
  if (!data) return undefined;
  const vendored = item.startsWith("node_modules/next/dist/compiled/");
  const name = data.name || (vendored ? item.slice("node_modules/next/dist/compiled/".length) : undefined);
  const version = data.version;
  const license = typeof data.license === "string" ? data.license :
    data.license?.type || data.licenses?.map(({ type }) => type).filter(Boolean).join(" OR ");
  const upstreamManifest = manifest(upstream);
  const sameVersion = upstreamManifest && upstreamManifest.version === version &&
    (upstreamManifest.name === data.name || vendored);
  // Next file tracing commonly strips the license file. Read it from the same installed source package.
  const textFiles = [
    ...licenseFiles(directory, license),
    ...(directory !== upstream && sameVersion ? licenseFiles(upstream, license) : []),
  ];
  const files = [...new Map(textFiles.map((entry) => [entry.name + "\0" + entry.text, entry])).values()];
  const nextVersion = vendored ? manifest(path.join(project, "node_modules/next")).version : undefined;
  return { name, version, license, vendoredBy: nextVersion ? "next@" + nextVersion : undefined, files };
}

function runtimePackages(directory, project) {
  const results = [];
  for (const file of fs.readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (file.name !== "package.json" || !file.isFile()) continue;
    const full = file.parentPath;
    const relative = path.relative(directory, full);
    const index = relative.indexOf("node_modules" + path.sep);
    if (index < 0) continue;
    const item = slash(relative.slice(index));
    if (item.startsWith("node_modules/.prisma/")) continue; // generated application client, covered by @prisma/client
    const ordinary = /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/.test(item);
    const vendored = item.startsWith("node_modules/next/dist/compiled/");
    if (ordinary || vendored) results.push(npmManifest(project, item, full, path.join(project, item)));
  }
  return results.filter(Boolean);
}

function bundlePackages(project, inputDir) {
  const files = fs.readdirSync(inputDir).filter((name) => name.endsWith(".json"));
  if (!files.some((name) => name.startsWith("webpack-")) || !files.includes("desktop-postgres.json")) {
    throw Error("缺少桌面运行时的 Webpack 或 esbuild 依赖清单");
  }
  const sources = new Set(files.flatMap((file) => {
    const items = readJson(path.join(inputDir, file));
    return file.startsWith("webpack-") ? items.map((resource) => packageRoot(project, resource)).filter(Boolean) : items;
  }));
  return [...sources].map((item) => {
    const directory = path.join(project, item);
    return npmManifest(project, item, directory, directory);
  }).filter(Boolean);
}

function consolidate(entries) {
  const packages = new Map();
  for (const entry of entries) {
    const key = JSON.stringify([entry.name, entry.version, entry.vendoredBy]);
    const prior = packages.get(key);
    if (!prior) packages.set(key, { ...entry, files: [...entry.files] });
    else {
      for (const file of entry.files) {
        if (!prior.files.some(({ name, text }) => file.name === name && file.text === text)) prior.files.push(file);
      }
    }
  }
  return [...packages.values()].sort((left, right) => compare(left.name, right.name) ||
    compare(left.version ?? "", right.version ?? "") || compare(left.vendoredBy ?? "", right.vendoredBy ?? ""));
}

function renderNotices(entries, source = false) {
  const packages = consolidate(entries);
  const texts = new Map();
  const lines = [
    "Inkvia Third-Party Notices",
    source ? "Union of npm packages identified in the desktop release builds." : "npm packages identified in this desktop application.",
    "",
    "This list includes shipped node_modules and packages bundled into JavaScript. The list",
    "also includes the npm distribution of Electron and of the PostgreSQL binaries.",
    "The PostgreSQL, Inter and FFmpeg license texts ship separately in app-runtime/licenses.",
    "Electron and Chromium notices are supplied with the Electron distribution.",
    "",
    "Packages (license type is declared by the corresponding package)",
    "===============================================================",
  ];
  const unresolved = [];
  for (const entry of packages) {
    const label = entry.name + (entry.version ? "@" + entry.version : " (version not declared)") +
      (entry.vendoredBy ? " [" + entry.vendoredBy + " vendored distribution]" : "");
    const references = entry.files.map(({ name, text }) => {
      if (!texts.has(text)) texts.set(text, texts.size + 1);
      return name + " #" + texts.get(text);
    });
    const license = entry.license || "not declared";
    lines.push(label + " | " + license + " | " + (references.join(", ") || "license file not available"));
    const issues = [
      ...(!entry.version ? ["version not declared"] : []),
      ...(!entry.license || entry.license === "UNLICENSED" ? ["license type not declared"] : []),
      ...(!references.length ? ["license file not available"] : []),
    ];
    if (issues.length) unresolved.push({ name: entry.name, version: entry.version, vendoredBy: entry.vendoredBy, issues });
  }
  const header = "\n\nLicense texts as distributed by the corresponding packages\n";
  const text = lines.join("\n") + header + [...texts].map(([body, index]) => {
    return "\n----- License #" + index + " -----\n" + body + (body.endsWith("\n") ? "" : "\n");
  }).join("");
  return { text, count: packages.length, unresolved };
}

export function writePackageNotices({ root, runtime, inputDir, postgresPackage, cross = false }) {
  const licenses = path.join(runtime, "licenses");
  fs.mkdirSync(licenses, { recursive: true });
  const postgres = manifest(postgresPackage);
  if (!postgres?.version?.startsWith(postgresVersion + ".")) {
    throw Error("PostgreSQL 版本变更，请更新随包版权声明后重新打包");
  }
  for (const [source, destination] of [
    [path.join(root, "desktop/licenses", postgresCopyright), postgresCopyright],
    [path.join(root, "app/fonts/OFL.txt"), "Inter-OFL-1.1.txt"],
  ]) fs.copyFileSync(source, path.join(licenses, destination));

  const electron = path.join(root, "node_modules/electron");
  if (!cross) {
    for (const [source, destination] of [["LICENSE", "Electron-LICENSE.txt"], ["LICENSES.chromium.html", "LICENSES.chromium.html"]]) {
      fs.copyFileSync(path.join(electron, "dist", source), path.join(licenses, destination));
    }
  } else {
    // The Windows Electron archive keeps its own notices at the installation root.
    for (const name of ["Electron-LICENSE.txt", "LICENSES.chromium.html"]) {
      fs.rmSync(path.join(licenses, name), { force: true });
    }
  }

  const entries = [
    ...runtimePackages(runtime, root),
    ...bundlePackages(root, inputDir),
    npmManifest(root, "node_modules/electron", electron, electron),
    npmManifest(root, "node_modules/" + postgres.name, postgresPackage, postgresPackage),
  ];
  const { text, count, unresolved } = renderNotices(entries);
  fs.writeFileSync(path.join(licenses, noticesName), text);
  const inventory = path.join(path.dirname(runtime), path.basename(runtime) + "-licenses.json");
  fs.writeFileSync(inventory, JSON.stringify({ entries, unresolved }));
  console.log(`第三方许可：${count} 个包，${unresolved.length} 个包的元数据待核对，详见 ${path.basename(inventory)}`);
}

function writeSourceNotices(destination, inventoryFiles) {
  if (!inventoryFiles.length) throw Error("请提供使用实际安装包生成的许可证清单");
  const entries = inventoryFiles.flatMap((file) => readJson(file).entries);
  const { text, count, unresolved } = renderNotices(entries, true);
  fs.writeFileSync(destination, text);
  console.log(`开源版第三方许可：${count} 个包，${unresolved.length} 个包的元数据待核对`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--source" || !process.argv[3]) {
    throw Error("用法：node desktop/scripts/third-party-notices.mjs --source <输出文件> <打包生成的许可证清单...>");
  }
  writeSourceNotices(process.argv[3], process.argv.slice(4));
}
