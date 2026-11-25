// Stage the client before installing it. A running Windows process may hold the native
// engine open; an identical installed engine need not be replaced.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
if (process.platform !== "win32") {
  const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "generate"], { stdio: "inherit", env: { ...process.env } });
  process.exit(result.status ?? 1);
}
const clientEntry = require.resolve(".prisma/client/index.js", { paths: [path.dirname(require.resolve("@prisma/client"))] });
const target = path.dirname(clientEntry);
const stagingRoot = fs.mkdtempSync(path.join(path.dirname(target), "p0-generate-"));
const output = path.join(stagingRoot, "client");
const schemaPath = path.join(stagingRoot, "schema.prisma");
const schema = fs.readFileSync("prisma/schema.prisma", "utf8").replace(/provider = "prisma-client-js"/, `provider = "prisma-client-js"\n  output = ${JSON.stringify(output.replace(/\\/g, "/"))}`);
fs.writeFileSync(schemaPath, schema);
const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "generate", "--schema", schemaPath], { stdio: "inherit", env: { ...process.env } });
if (result.status !== 0) process.exit(result.status || 1);
function digest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (!fs.existsSync(to) || digest(from) !== digest(to)) fs.copyFileSync(from, to);
  }
}
copyDirectory(output, target);
console.log("Prisma client generated; unchanged native engine preserved.");
