const path = require("node:path");
const { writeJson } = require("./config.cjs");
function policy(p, c) {
  writeJson(p.policy, { schemaVersion: 1, profile: "production", projectRoot: p.root,
    runtimeRoot: p.runtime, database: { endpointId: "127.0.0.1:" + c.pgPort,
      databaseName: "inkvia", roleName: "inkvia", instanceId: c.instanceId },
    writableRoots: [p.uploads, p.imports, p.exports, p.run], networkMode: "production", allowedTestOrigins: [] });
}
function environment(p, c) {
  const base = {};
  for (const k of ["HOME", "USER", "LOGNAME", "LANG", "SystemRoot", "WINDIR", "COMSPEC", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]) {
    if (process.env[k]) base[k] = process.env[k];
  }
  const origin = "http://127.0.0.1:" + c.webPort;
  return { ...base, PATH: [path.dirname(p.ffmpeg), path.dirname(p.ffprobe),
    process.env.PATH].join(path.delimiter), TEMP: p.run, TMP: p.run, TMPDIR: p.run, PRISMA_SCHEMA_ENGINE_BINARY: p.schemaEngine, PRISMA_QUERY_ENGINE_LIBRARY: p.queryEngine, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production",
    INKVIA_RUNTIME_PROFILE: "production", INKVIA_RUNTIME_POLICY: p.policy, INKVIA_DESKTOP_MODE: "1",
    INKVIA_DESKTOP_PROXY_FILE: path.join(p.run, "system-proxy.json"),
    DATABASE_URL: `postgresql://inkvia:${c.appPassword}@127.0.0.1:${c.pgPort}/inkvia?schema=public&connection_limit=5`,
    APP_ROOT_DIR: p.root, UPLOADS_DIR: p.uploads, IMPORTS_DIR: p.imports, EXPORTS_DIR: p.exports,
    USER_IMPORT_MAX_BYTES: String(20 * 1024 ** 3), USER_EXPORT_MAX_BYTES: String(20 * 1024 ** 3),
    NEXT_PUBLIC_APP_URL: origin, APP_ORIGIN: origin, HOSTNAME: "127.0.0.1", PORT: String(c.webPort),
    ADMIN_USERNAME: "admin", ADMIN_PASSWORD: c.ADMIN_PASSWORD, ADMIN_SECRET: c.ADMIN_SECRET,
    AUTH_COOKIE_SECURE: "false", ADMIN_COOKIE_SECURE: "false", PASSWORD_CIPHER_KEYRING_FILE: p.keys,
    PASSWORD_CIPHER_ACTIVE_KEY_ID: "desktop-v1", CANVAS_WORKER_TOKEN: c.CANVAS_WORKER_TOKEN,
    INTERNAL_METRICS_TOKEN: c.INTERNAL_METRICS_TOKEN, MAINTENANCE_SENTINEL: path.join(p.run, "maintenance"),
    CANVAS_WORKER_IDLE_LOG_MS: "30000",
    NEXT_TELEMETRY_DISABLED: "1", LIVE_VIDEO_PROMPT_CONCURRENCY: "10", LIVE_VIDEO_VIDEO_CONCURRENCY: "10",
  };
}
module.exports = { policy, environment };
