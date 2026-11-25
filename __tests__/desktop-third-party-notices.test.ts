import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { writeBundleInputs, writePackageNotices } from "../desktop/scripts/third-party-notices.mjs";

it("includes traced and bundled package licenses and reports missing upstream information", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkvia-notices-"));
  function write(relative: string, value: string | object) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  }
  try {
    const main = { name: "traced", version: "1.0.0", license: "MIT" };
    write("runtime/.next/standalone/node_modules/traced/package.json", main);
    write("node_modules/traced/package.json", main);
    write("node_modules/traced/LICENSE", "Traced package license.\n");
    write("node_modules/@sample/webpack/package.json", { name: "@sample/webpack", version: "2.0.0", license: "MIT" });
    write("node_modules/@sample/webpack/COPYING", "Webpack package license.\n");
    write("node_modules/packed/package.json", { name: "packed", version: "3.0.0", license: "MIT" });
    write("node_modules/packed/LICENSE", "Packed package license.\n");
    write("node_modules/removed/package.json", { name: "removed", version: "1.0.0" });
    write("runtime/node_modules/missing/package.json", { name: "missing", version: "1.0.0" });
    write("node_modules/electron/package.json", { name: "electron", version: "45.4.1", license: "MIT" });
    write("node_modules/electron/dist/LICENSE", "Electron license.\n");
    write("node_modules/electron/dist/LICENSES.chromium.html", "Chromium notices.\n");
    write("postgres/package.json", { name: "@embedded-postgres/darwin-arm64", version: "16.16.0-beta.19", license: "MIT" });
    write("desktop/licenses/PostgreSQL-16.16-COPYRIGHT.txt", "PostgreSQL copyright.\n");
    write("app/fonts/OFL.txt", "Inter license.\n");
    write("inputs/webpack-client.json", [path.join("node_modules", "@sample", "webpack", "index.js")]);
    const inputDir = path.join(root, "inputs");
    writeBundleInputs(inputDir, "desktop-postgres", root, { outputs: { "bundle.out": { inputs: {
      [path.join("node_modules", "packed", "index.js")]: { bytesInOutput: 48 },
      [path.join("node_modules", "removed", "index.js")]: { bytesInOutput: 0 },
    } } } });
    writePackageNotices({ root, runtime: path.join(root, "runtime"), inputDir, postgresPackage: path.join(root, "postgres") });
    const text = fs.readFileSync(path.join(root, "runtime/licenses/THIRD_PARTY_NOTICES.txt"), "utf8");
    expect(text).toContain("traced@1.0.0 | MIT | LICENSE");
    expect(text).toContain("@sample/webpack@2.0.0 | MIT | COPYING");
    expect(text).toContain("packed@3.0.0 | MIT | LICENSE");
    expect(text).toContain("Traced package license.\n");
    expect(text).toContain("Webpack package license.\n");
    expect(text).toContain("Packed package license.\n");
    expect(text).toContain("missing@1.0.0 | not declared | license file not available");
    expect(text).not.toContain("removed@1.0.0");
    expect(fs.readFileSync(path.join(root, "runtime/licenses/PostgreSQL-16.16-COPYRIGHT.txt"), "utf8"))
      .toBe("PostgreSQL copyright.\n");
    expect(fs.readFileSync(path.join(root, "runtime/licenses/Inter-OFL-1.1.txt"), "utf8")).toBe("Inter license.\n");
    expect(fs.readFileSync(path.join(root, "runtime/licenses/Electron-LICENSE.txt"), "utf8")).toBe("Electron license.\n");
    expect(fs.readFileSync(path.join(root, "runtime/licenses/LICENSES.chromium.html"), "utf8")).toBe("Chromium notices.\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
