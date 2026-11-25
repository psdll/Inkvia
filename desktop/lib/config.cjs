const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { randomBytes, randomUUID } = require("node:crypto");

function writeJson(file, value) {
  const tmp = file + "." + randomUUID() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}
function paths(dataHome, packaged = false) {
  const p = require("./runtime-paths.cjs").runtimePaths(packaged);
  for (const name of ["uploads", "imports", "exports", "logs", "config", "run", "postgres"]) {
    p[name] = path.join(dataHome, name);
    fs.mkdirSync(p[name], { recursive: true, mode: 0o700 });
  }
  p.data = path.join(p.postgres, "data");
  p.settings = path.join(p.config, "desktop-config.json");
  p.keys = path.join(p.config, "password-keys.json");
  p.policy = path.join(p.config, "runtime-policy.json");
  return p;
}
function load(p) {
  if (fs.existsSync(p.settings)) return JSON.parse(fs.readFileSync(p.settings, "utf8"));
  if (fs.existsSync(p.data) || fs.existsSync(p.keys)) throw Error("已有数据库或密钥环，请恢复原配置");
  const secret = () => randomBytes(32).toString("hex");
  const config = { instanceId: randomUUID(), ownerPassword: secret(), appPassword: secret(),
    ADMIN_PASSWORD: secret(), ADMIN_SECRET: secret(), CANVAS_WORKER_TOKEN: secret(),
    INTERNAL_METRICS_TOKEN: secret(), initialized: false };
  writeJson(p.settings, config);
  return config;
}
async function port(preferred = 0) {
  try {
    return await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(preferred, "127.0.0.1", () => {
        const selected = s.address().port;
        s.close(() => resolve(selected));
      });
    });
  } catch (e) {
    if (preferred && e.code === "EADDRINUSE") return port();
    throw e;
  }
}
module.exports = { writeJson, paths, load, port };
