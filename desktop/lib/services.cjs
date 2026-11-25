const { spawn, execFile } = require("node:child_process");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const workers = require("./workers.cjs");
const { workerQueuePool } = require("./postgres.cjs");
const { createWorkerScheduler } = require("./worker-scheduler.cjs");
const { readWorkerQueues, countUnfinishedTasks } = require("./worker-queues.cjs");

const WORKER_POLL_MS = 1_000;
function services(p, config, env, log, onServerExit) {
  const children = new Map();
  let stopping = false, scheduler, queuePool, queueTimer, pendingPoll, endingQueuePool;
  function launch(name, args, cwd = p.runtime, worker = false) {
    const childEnv = worker
      ? { ...env, DATABASE_URL: env.DATABASE_URL.replace(/connection_limit=\d+/, "connection_limit=2") }
      : env;
    const stdio = ["ignore", "pipe", "pipe"];
    if (worker) stdio.push("ipc");
    const child = spawn(process.execPath, args, { cwd, env: childEnv, windowsHide: true, stdio });
    log.pipe(name, child);
    log.write(name, "启动 pid=" + child.pid);
    const done = new Promise(resolve => {
      child.once("error", error => log.write(name, error));
      child.once("close", (code, signal) => {
        children.delete(name);
        log.write(name, "退出 " + (signal || code));
        resolve(code);
      });
    });
    children.set(name, { child, done });
    return { child, done };
  }
  async function next() {
    let exited = false;
    let ready = false;
    launch("next", ["--require", p.probeBootstrap, "server.js"]).done.then(() => {
      exited = true;
      if (ready && !stopping) onServerExit();
    });
    const until = Date.now() + 90000;
    while (!stopping && !exited && Date.now() < until) {
      try {
        const res = await fetch(env.NEXT_PUBLIC_APP_URL, { redirect: "manual", signal: AbortSignal.timeout(1500) });
        await res.body?.cancel();
        if (res.status >= 200 && res.status < 400) { ready = true; return; }
      } catch {}
      await delay(150);
    }
    throw Error("Next 服务未就绪，请查看 next.log");
  }
  function startWorkerScheduler() {
    queuePool = workerQueuePool(config);
    queuePool.on("error", error => log.write("desktop", "任务队列连接：" + error.message));
    scheduler = createWorkerScheduler(workers, {
      launch({ name, script, args }) {
        const control = path.join(p.runtime, "scripts", "desktop-worker-control.cjs");
        const { child, done } = launch(name, ["--require", control, path.join(p.root, script), ...args], p.runtime, true);
        return {
          done,
          drain() {
            if (!child.connected) return false;
            child.send("desktop:worker-idle", error => {
              if (error) log.write(name, "空闲退出通知：" + error.message);
            });
            log.write(name, "已空闲五分钟，等待本轮结束后退出");
            return true;
          },
        };
      },
      report: (name, message) => log.write(name, message),
    });
    // Start both canvas heartbeats immediately; recover the durable queues on the first poll.
    scheduler.reconcile({});
    async function poll() {
      try {
        scheduler.reconcile(await readWorkerQueues(queuePool, config.instanceId));
      } catch (error) {
        if (!stopping) log.write("desktop", "读取任务队列：" + error.message);
      } finally {
        if (!stopping) queueTimer = setTimeout(() => { pendingPoll = poll(); }, WORKER_POLL_MS);
      }
    }
    pendingPoll = poll();
  }
  async function stop() {
    stopping = true;
    scheduler?.stop();
    clearTimeout(queueTimer);
    if (queuePool) endingQueuePool ??= Promise.resolve(pendingPoll).then(() => queuePool.end());
    const alive = [...children].sort(([a], [b]) => Number(a === "next") - Number(b === "next"));
    for (const [, { child }] of alive) {
      if (process.platform === "win32" && child.pid && child.exitCode === null) {
        // Terminate the service tree, including in-flight media and Prisma subprocesses.
        execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true },
          error => { if (error && child.exitCode === null) child.kill(); });
      } else child.kill("SIGTERM");
    }
    const kill = setTimeout(() => {
      for (const { child } of children.values()) child.kill("SIGKILL");
    }, 10000);
    try { await Promise.all([endingQueuePool, ...alive.map(([, item]) => item.done)]); } finally { clearTimeout(kill); }
  }
  async function migrate() {
    const result = await launch("migrate", [p.prismaCli, "migrate", "deploy",
      "--schema", p.schema], p.root).done;
    if (result !== 0) throw Error("数据库迁移失败，请查看 migrate.log");
  }
  return { next, startWorkerScheduler, stop, migrate,
    countUnfinished: () => queuePool ? countUnfinishedTasks(queuePool, config.instanceId) : Promise.resolve(0) };
}
module.exports = { services };
