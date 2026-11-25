const fs = require("node:fs");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const { getRuntimePolicy, assertWritablePath, assertNetworkTarget, assertRuntimeVerified, within, realTarget, RuntimeIsolationError } = require("./runtime-isolation.cjs");

// Process boundary protection also covers fs-extra and direct HTTP clients.
// This is an accidental-access guard; OS/service credentials remain the security boundary.
function installRuntimeBoundaries() {
  const marker = Symbol.for("inkvia.runtime-boundaries");
  if (globalThis[marker]) return;
  const policy = getRuntimePolicy();
  // Normal local business uses native filesystem/HTTP/socket behavior. Resource
  // identity and explicit application storage checks still run at their entrypoints.
  if (policy.profile === "local" && policy.networkMode === "business") return;
  globalThis[marker] = true;
  function checkPath(target) {
    if (typeof target === "number") throw new RuntimeIsolationError("ENV_PATH_OUTSIDE_ROOT", "untracked-descriptor");
    const absolute = realTarget(target instanceof URL ? require("node:url").fileURLToPath(target) : String(target));
    // Next's own compiler caches are not application data.
    const relative = path.relative(policy.projectRoot, absolute).split(path.sep)[0];
    if (/^\.next(?:[-\w]*)$/.test(relative) && within(policy.projectRoot, absolute)) return;
    assertRuntimeVerified(policy);
    assertWritablePath(target, policy);
  }
  function wrap(object, name, indexes, shouldCheck = () => true) {
    const original = object[name];
    if (typeof original !== "function") return;
    object[name] = function (...args) {
      if (shouldCheck(args)) for (const index of indexes) checkPath(args[index]);
      return original.apply(this, args);
    };
  }
  const writes = ["writeFile", "appendFile", "mkdir", "mkdtemp", "unlink", "rm", "rmdir", "truncate", "chmod", "chown", "utimes"];
  for (const name of writes) {
    wrap(fs, name, [0]); wrap(fs, `${name}Sync`, [0]); wrap(fs.promises, name, [0]);
  }
  for (const name of ["rename", "link"]) {
    wrap(fs, name, [0, 1]); wrap(fs, `${name}Sync`, [0, 1]); wrap(fs.promises, name, [0, 1]);
  }
  for (const [object, name] of [[fs, "symlink"], [fs, "symlinkSync"], [fs.promises, "symlink"]]) {
    const original = object[name];
    object[name] = function (...args) {
      checkPath(args[1]);
      checkPath(path.resolve(path.dirname(String(args[1])), String(args[0])));
      return original.apply(this, args);
    };
  }
  for (const name of ["copyFile", "cp"]) {
    wrap(fs, name, [1]); wrap(fs, `${name}Sync`, [1]); wrap(fs.promises, name, [1]);
  }
  const writableOpen = (args) => typeof args[1] === "number"
    ? (args[1] & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0
    : /[wa+]/.test(args[1] || "r");
  wrap(fs, "open", [0], writableOpen); wrap(fs, "openSync", [0], writableOpen); wrap(fs.promises, "open", [0], writableOpen);
  wrap(fs, "createWriteStream", [0]);
  // fs-extra copies the native methods at import time; guard that copy as well.
  const extra = require("fs-extra");
  for (const name of ["ensureDir", "ensureFile", "outputFile", "outputJson", "writeJson", "remove", ...writes]) {
    wrap(extra, name, [0]); wrap(extra, `${name}Sync`, [0]);
  }
  for (const name of ["move", "moveSync"]) wrap(extra, name, [0, 1]);
  for (const name of ["copy", "copySync"]) wrap(extra, name, [1]);

  // Check each redirect at the request boundary, including clients bypassing provider transport.
  for (const [protocol, module] of [["http", require("node:http")], ["https", require("node:https")]]) {
    const request = module.request;
    module.request = function (input, ...args) {
      const options = typeof input === "string" || input instanceof URL ? new URL(input) : input;
      const target = options instanceof URL ? options : `${options.protocol || `${protocol}:`}//${options.hostname || options.host || "localhost"}${options.port ? `:${options.port}` : ""}${options.path || "/"}`;
      assertNetworkTarget(target, policy);
      return request.call(this, input, ...args);
    };
    module.get = function (...args) { const request = module.request(...args); request.end(); return request; };
  }
  const fetch = globalThis.fetch;
  if (fetch) globalThis.fetch = async function (input, init) {
    let request = new Request(input, init);
    for (let hop = 0; hop < 10; hop++) {
      assertNetworkTarget(request.url, policy);
      const response = await fetch(request, { redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status) || request.redirect === "manual") return response;
      if (request.redirect === "error") throw new RuntimeIsolationError("ENV_EGRESS_DENIED", "redirect");
      const location = response.headers.get("location");
      if (!location) return response;
      await response.body?.cancel();
      // Provider POST redirects need explicit transport handling; never replay a body or secrets.
      if (!["GET", "HEAD"].includes(request.method)) throw new RuntimeIsolationError("ENV_EGRESS_DENIED", "body-redirect");
      const target = new URL(location, request.url);
      const headers = new Headers(request.headers);
      if (target.origin !== new URL(request.url).origin) { headers.delete("authorization"); headers.delete("cookie"); }
      request = new Request(target, { method: request.method, headers, signal: request.signal });
    }
    throw new RuntimeIsolationError("ENV_EGRESS_DENIED", "redirect-limit");
  };
  // undici, OSS SDKs, telemetry and proxy sockets must stay in the same allowlist.
  const net = require("node:net");
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = typeof first === "object" ? first : { port: first, host: typeof args[1] === "string" ? args[1] : "localhost" };
    if (policy.profile === "build") throw new RuntimeIsolationError("BUILD_EXTERNAL_IO_DENIED", "socket");
    if (policy.profile !== "production" || policy.networkMode !== "production") {
      const endpoint = `${String(options.host || "localhost").toLowerCase()}:${options.port}`;
      const allowed = policy.allowedTestOrigins.some((origin) => { const url = new URL(origin); return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}` === endpoint; });
      if (!allowed || options.path) throw new RuntimeIsolationError("ENV_EGRESS_DENIED", "socket");
    }
    return connect.apply(this, args);
  };
  syncBuiltinESMExports();
}
module.exports = { installRuntimeBoundaries };
