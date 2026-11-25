import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function copyPostgres(source, destination, platform = process.platform) {
  const win = platform === "win32";
  const arch = process.arch === "arm64" ? "arm64" : "x86_64";
  const pgLib = win ? "lib" : path.join("lib", "postgresql");
  const shared = win ? "share" : path.join("share", "postgresql");
  const vendor = win ? "bin" : "lib";
  const vendorFiles = fs.readdirSync(path.join(source, vendor)).filter(n => win ? n.endsWith(".dll") : n.endsWith(".dylib"));
  const copied = new Set();
  function binary(relative) {
    if (copied.has(relative)) return;
    copied.add(relative);
    const from = path.join(source, relative), to = path.join(destination, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (win) {
      fs.copyFileSync(from, to);
      // Imported and dynamically loaded vendor DLL names are C strings in the PE.
      const strings = fs.readFileSync(from).toString("latin1").toLowerCase();
      for (const dll of vendorFiles) if (strings.includes(dll.toLowerCase() + "\0")) binary(path.join(vendor, dll));
    } else {
      const slices = execFileSync("lipo", ["-archs", from], { encoding: "utf8" }).trim().split(/\s+/);
      if (!slices.includes(arch)) throw Error("PostgreSQL 架构不匹配：" + relative);
      if (slices.length > 1) execFileSync("lipo", [from, "-thin", arch, "-output", to]);
      else fs.copyFileSync(from, to);
      fs.chmodSync(to, 0o755);
      const deps = execFileSync("otool", ["-l", to], { encoding: "utf8" });
      for (const match of deps.matchAll(/cmd LC_(?:LOAD(?:_WEAK)?|REEXPORT)_DYLIB\s+cmdsize \d+\s+name (@[^ ]+) \(offset/g)) {
        const name = path.basename(match[1]);
        if (vendorFiles.includes(name)) binary(path.join(vendor, name));
      }
    }
  }
  for (const name of ["initdb", "postgres", "pg_ctl"]) binary(path.join("bin", name + (win ? ".exe" : "")));
  // initdb installs the built-in text dictionaries, encoding conversions and PL/pgSQL.
  for (const name of fs.readdirSync(path.join(source, pgLib))) {
    if (/^(?:plpgsql|dict_snowball|[a-z0-9_]+_and_[a-z0-9_]+)\.(?:dll|dylib)$/.test(name)) binary(path.join(pgLib, name));
  }
  fs.cpSync(path.join(source, shared), path.join(destination, shared), {
    recursive: true, dereference: true, filter(file) {
      const [first, second] = path.relative(path.join(source, shared), file).split(path.sep);
      if (first === "extension") return !second || second.startsWith("plpgsql");
      return !["locale", "doc", "contrib", "man", "psqlrc.sample", "pg_service.conf.sample"].includes(first);
    },
  });
}
