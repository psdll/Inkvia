import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  normalizeStandaloneBuildPaths,
  packagePathScanner,
} from "../desktop/scripts/package-path-privacy.mjs";

const home = "/Users/build-account";
const root = home + "/素材 project/source";
const scan = packagePathScanner({ root, home, username: "build-account" });
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "inkvia-package-test-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function write(relative: string, contents: string | Buffer) {
  const file = path.join(directory, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

it("normalizes the same client reference in generated code and manifests", () => {
  const id = root + "/app/page.tsx#default";
  write("server.js", "const id = " + JSON.stringify(id));
  write(".next/server/reference.json", JSON.stringify({ [id]: "page.js" }));
  write(".next/static/chunk.js", JSON.stringify("file://" + encodeURI(root) + "/archive.js"));
  write("node_modules/.prisma/client/index.js", JSON.stringify(root + "/prisma/schema.prisma"));
  normalizeStandaloneBuildPaths(directory, root);
  expect(fs.readFileSync(path.join(directory, "server.js"), "utf8")).toContain("/inkvia-build/app/page.tsx#default");
  expect(fs.readFileSync(path.join(directory, ".next/server/reference.json"), "utf8"))
    .toContain("/inkvia-build/app/page.tsx#default");
  expect(fs.readFileSync(path.join(directory, ".next/static/chunk.js"), "utf8"))
    .toBe('"file:///inkvia-build/archive.js"');
  expect(() => scan(directory)).not.toThrow();
});

it("rejects a remaining encoded project path", () => {
  write("nested/main.js", JSON.stringify(encodeURI(root) + "/private.js"));
  expect(() => scan(directory)).toThrow("nested" + path.sep + "main.js");
});

it("rejects UTF-16 profile paths in binary files", () => {
  write("runtime.exe", Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.from(home + "/config", "utf16le")]));
  expect(() => scan(directory)).toThrow("runtime.exe");
});

it("rejects build account metadata without requiring a path", () => {
  write("app.json", JSON.stringify({ buildUser: "build-account" }));
  expect(() => scan(directory)).toThrow("app.json");
});
