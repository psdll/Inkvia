const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { writeJson } = require("./config.cjs");
const { Client, Pool } = require("pg");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const win = process.platform === "win32";

async function database(p, c, log) {
  if (!fs.existsSync(p.keys)) {
    if (fs.existsSync(p.data) || c.initialized) throw Error("缺少原密码密钥环");
    writeJson(p.keys, { "desktop-v1": randomBytes(32).toString("base64") });
  }
  const bin = name => path.join(p.pgBin, name + (win ? ".exe" : ""));
  const options = { cwd: p.root, windowsHide: true, env: { ...process.env, LC_MESSAGES: "C", APP_ROOT_DIR: p.root } };
  let data = c.pgFallbackData || p.data;
  async function initialise() {
    const pwfile = path.join(path.dirname(data), ".pw-" + randomBytes(16).toString("hex"));
    fs.writeFileSync(pwfile, c.ownerPassword + "\n", { flag: "wx", mode: 0o600 });
    try {
      const { stdout } = await run(bin("initdb"), ["-D", data, "--no-clean", "--username=postgres",
        "--auth=scram-sha-256", "--locale=C", "--encoding=UTF8", "--lc-messages=C", "--pwfile=" + pwfile], options);
      log(stdout);
    } finally { fs.unlinkSync(pwfile); }
  }
  if (!fs.existsSync(path.join(data, "PG_VERSION"))) {
    if (c.initialized || (fs.existsSync(data) && fs.readdirSync(data).length)) throw Error("数据库目录不完整，请检查日志");
    try { await initialise(); }
    catch (error) {
      if (!win || c.pgFallbackData || !/[^\x00-\x7F]/.test(data)) throw error;
      // Only a new cluster may fall back. Keep the failed directory intact.
      const parent = path.join(process.env.ProgramData, "Inkvia-" + c.instanceId);
      if (/[^\x00-\x7F]/.test(parent)) throw error;
      fs.mkdirSync(parent);
      const { stdout } = await run("whoami.exe", ["/user", "/fo", "csv", "/nh"], options);
      const sid = stdout.match(/S-1-[0-9-]+/i)?.[0];
      if (!sid) throw Error("无法确定当前 Windows 用户");
      await run("icacls.exe", [parent, "/inheritance:r", "/grant:r", "*" + sid + ":(OI)(CI)F"], options);
      data = path.join(parent, "data");
      c.pgFallbackData = data;
      writeJson(p.settings, c);
      await initialise();
    }
  }
  const pidFile = path.join(data, "postmaster.pid");
  if (fs.existsSync(pidFile)) {
    // The app can die while its postmaster survives. Confirm the exact live instance
    // before stopping it; PostgreSQL handles dead/reused PID locks on its own.
    const [pid, , , port] = fs.readFileSync(pidFile, "utf8").split(/\r?\n/);
    if (/^[1-9]\d*$/.test(pid) && Number(port) > 0 && Number(port) <= 65535) {
      const probe = new Client({ host: "127.0.0.1", port: Number(port), database: "postgres",
        user: "postgres", password: c.ownerPassword, connectionTimeoutMillis: 1500 });
      let matches = false;
      try {
        process.kill(Number(pid), 0);
        await probe.connect();
        const { rows: [row] } = await probe.query("SELECT current_setting('inkvia.instance_id',true) AS id, current_setting('data_directory') AS dir");
        matches = row.id === c.instanceId && fs.realpathSync(row.dir) === fs.realpathSync(data);
      } catch { /* A stale PID does not identify a running database. */ }
      finally { await probe.end().catch(() => {}); }
      if (matches) await run(bin("pg_ctl"), ["stop", "-D", data, "-m", "fast", "-w"], options);
    }
  }
  // PostgreSQL itself checks stale PID files and recovers WAL. Never unlink its lock.
  const child = spawn(bin("postgres"), ["-D", data, "-p", String(c.pgPort), "-h", "127.0.0.1",
    "-c", "unix_socket_directories=", "-c", "lc_messages=C", "-c", "max_connections=30", "-c", "inkvia.instance_id=" + c.instanceId],
    { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise(resolve => child.once("close", resolve));
  child.stdout.on("data", chunk => log(chunk.toString()));
  const ready = new Promise((resolve, reject) => {
    let last = "";
    child.stderr.on("data", chunk => {
      const text = chunk.toString();
      log(text);
      last = (last + text).slice(-4096);
      if (last.includes("database system is ready to accept connections")) resolve();
    });
    child.once("error", reject);
    child.once("close", () => reject(Error("PostgreSQL 启动失败，请查看 postgres.log")));
  });
  async function stop() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await run(bin("pg_ctl"), ["stop", "-D", data, "-m", "fast", "-w"], options);
    await closed;
  }
  // A competing live cluster rejects startup. Only stop a child that reached readiness.
  await ready;
  try {
    if (!c.initialized) {
      const client = new Client({ host: "127.0.0.1", port: c.pgPort, user: "postgres", database: "postgres", password: c.ownerPassword });
      await client.connect();
      try {
        if (!(await client.query("SELECT FROM pg_roles WHERE rolname='inkvia'")).rowCount) {
          if (!/^[a-f0-9]{64}$/.test(c.appPassword)) throw Error("应用密码格式错误");
          await client.query(`CREATE ROLE inkvia LOGIN PASSWORD '${c.appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
        }
        if (!(await client.query("SELECT FROM pg_database WHERE datname='inkvia'")).rowCount) {
          await client.query("CREATE DATABASE inkvia OWNER inkvia ENCODING 'UTF8' TEMPLATE template0");
        }
        await client.query("REVOKE CONNECT ON DATABASE postgres FROM PUBLIC");
      } finally { await client.end(); }
      c.initialized = true;
      writeJson(p.settings, c);
    }
    return stop;
  } catch (err) { await stop(); throw err; }
}

function workerQueuePool(c) {
  return new Pool({ host: "127.0.0.1", port: c.pgPort, database: "inkvia", user: "inkvia",
    password: c.appPassword, max: 1, connectionTimeoutMillis: 1500, statement_timeout: 3000 });
}
module.exports = { database, workerQueuePool };
