const os = require("node:os");
const { createHmac, randomBytes } = require("node:crypto");
const { writeJson } = require("./config.cjs");
const adminCookie = "ai_studio_admin";
const adminTokenTtl = 10 * 365 * 24 * 60 * 60;

function createDesktopAdminToken(username, secret, ttlSeconds = adminTokenTtl, now = Math.floor(Date.now() / 1000)) {
  const body = Buffer.from(JSON.stringify({ u: username, iat: now, exp: now + ttlSeconds }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret.trim()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function systemUsername() {
  try { return os.userInfo().username.trim() || "本机用户"; }
  catch { return "本机用户"; }
}

function desktopSession(session, origin, config, settingsFile) {
  let installingAdminSession;
  async function request(path, label, body) {
    try {
      return await session.fetch(origin + path, {
        credentials: "include", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(15000),
        ...(body ? { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify(body) } : {}),
      });
    } catch { throw Error(label + "失败：无法连接客户端服务"); }
  }
  function check(response, label) {
    if (!response.ok) throw Error(label + "失败（HTTP " + response.status + "）");
  }
  function adminStatus() {
    return request("/api/admin/session", "检查管理员会话");
  }
  function installAdminSession() {
    if (!installingAdminSession) installingAdminSession = (async () => {
      const now = Math.floor(Date.now() / 1000);
      const value = createDesktopAdminToken("admin", config.ADMIN_SECRET, adminTokenTtl, now);
      await session.cookies.set({ url: origin, name: adminCookie, value, httpOnly: true,
        sameSite: "lax", path: "/", secure: false, expirationDate: now + adminTokenTtl });
      check(await adminStatus(), "确认管理员会话");
    })().finally(() => { installingAdminSession = undefined; });
    return installingAdminSession;
  }
  async function ensureAdmin() {
    const response = await adminStatus();
    if (response.status === 401) await installAdminSession();
    else check(response, "检查管理员会话");
  }
  function saveUser(localUser) {
    config.localUser = localUser;
    writeJson(settingsFile, config);
  }
  function finishRegistration() {
    if (config.localUser?.registrationAttempt) {
      const { registrationAttempt, ...registered } = config.localUser;
      saveUser(registered);
    }
  }
  async function currentUser() {
    const response = await request("/api/auth/me", "检查本机账号");
    check(response, "检查本机账号");
    return (await response.json()).user;
  }
  async function loginUser() {
    const current = await currentUser();
    if (current) {
      if (current.username === config.localUser?.username) finishRegistration();
      return;
    }
    let local = config.localUser;
    if (local) {
      const response = await request("/api/auth/login", "本机账号登录", {
        username: local.username, password: local.password,
      });
      const missing = response.status === 404
        && (await response.json().catch(() => null))?.code === "AUTH_USER_NOT_FOUND";
      if (!missing) {
        check(response, "本机账号登录");
        finishRegistration();
        return;
      }
      // Keep saved credentials for an interrupted registration. A deleted account gets new credentials.
      if (!local.registrationAttempt) local = { username: local.username };
    }
    const base = local ? local.username : systemUsername();
    const first = local?.registrationAttempt || 1;
    const stem = first === 1 ? base : base.slice(0, -("-" + first).length);
    const password = local?.password || randomBytes(32).toString("hex");
    const createdAt = local?.createdAt || new Date().toISOString();
    for (let attempt = first; attempt <= 6; attempt++) {
      const suffix = attempt === 1 ? "" : "-" + attempt;
      const username = stem.slice(0, 64 - suffix.length).replace(/[\uD800-\uDBFF]$/, "") + suffix;
      saveUser({ username, password, createdAt, registrationAttempt: attempt });
      check(await request("/api/admin/auth-users", "添加本机账号到白名单", {
        action: "add_whitelist", names: [username],
      }), "添加本机账号到白名单");
      const response = await request("/api/auth/register", "注册本机账号", { username, password });
      if (response.status === 409) continue;
      check(response, "注册本机账号");
      finishRegistration();
      return;
    }
    throw Error("本机账号名称已被占用，已达到同名重试上限");
  }
  return { installAdminSession, ensureAdmin, loginUser };
}

module.exports = { createDesktopAdminToken, desktopSession };
