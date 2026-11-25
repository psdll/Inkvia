const { spawn } = require("child_process");
const { loadEnvConfig } = require("@next/env");
const { prepareRuntime, getRuntimePolicy } = require("./lib/runtime-isolation.cjs");
let requestedExitCode = null;

const WARM_DEV_ROUTES = [
  "/",
  "/studio",
  "/batch-workbench",
  "/works",
  "/materials",
  "/agent",
  "/settings",
  "/canvas",
];
const WARM_DEV_API_ROUTES = [
  "/api/auth/me",
  "/api/auth/me/stats",
  "/api/settings/entry",
  "/api/settings/model-usage",
  "/api/logs?limit=1",
  "/api/logs/stats",
  "/api/image-edit/models",
  "/api/toolbox/models?category=video",
  "/api/prompt-reverse?limit=1&surface=toolbox_video",
  "/api/role-positioning/draft?surface=toolbox_video",
  "/api/system-notice",
  "/api/tutorial-doc",
  "/api/material-request-doc",
  "/api/material-assets/categories",
  "/api/material-assets/upload-permission",
  "/api/material-assets?page=1&pageSize=1&status=all",
  "/api/assets?userId=0&tab=generated&take=1&source=creation&type=all",
];

const mode = process.argv[2];
const args = process.argv.slice(3);

function consumeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

const withWorkers = consumeFlag("--with-workers");
const webOnly = consumeFlag("--web-only");

function readOptionValue(names, fallback) {
  const index = args.findIndex((arg) => names.includes(arg));
  return index === -1 ? fallback : args[index + 1] || fallback;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function requestDevRoute(baseUrl, route) {
  // Warming is optional and disabled for the default offline development profile.
  const policy = getRuntimePolicy();
  if (policy.networkMode !== "business" && !policy.allowedTestOrigins?.includes(baseUrl)) return 0;
  const response = await fetch(`${baseUrl}${route}`, {
    headers: {
      accept: "text/html",
      "user-agent": "inkvia-local-route-warmup",
    },
    signal: AbortSignal.timeout(60_000),
  });
  await response.arrayBuffer();
  return response.status;
}

async function warmDevRoute(baseUrl, route) {
  const routeStartedAt = Date.now();
  try {
    const status = await requestDevRoute(baseUrl, route);
    process.stdout.write(`[dev] warmed ${route} (${status}, ${Date.now() - routeStartedAt}ms)\n`);
  } catch (error) {
    process.stderr.write(`[dev] failed to warm ${route}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function warmDevRoutes() {
  const port = readOptionValue(["-p", "--port"], "3000");
  const baseUrl = `http://127.0.0.1:${port}`;
  const readyDeadline = Date.now() + 60_000;

  process.stdout.write(`[dev] warming ${WARM_DEV_ROUTES.length} workspace routes...\n`);

  while (requestedExitCode === null && Date.now() < readyDeadline) {
    try {
      await requestDevRoute(baseUrl, WARM_DEV_ROUTES[0]);
      break;
    } catch {
      await wait(250);
    }
  }

  if (requestedExitCode !== null || Date.now() >= readyDeadline) return;

  const startedAt = Date.now();
  await Promise.all(WARM_DEV_ROUTES.slice(1).map((route) => warmDevRoute(baseUrl, route)));
  if (requestedExitCode !== null) return;
  await Promise.all(WARM_DEV_API_ROUTES.map((route) => warmDevRoute(baseUrl, route)));

  process.stdout.write(`[dev] workspace routes ready (${Date.now() - startedAt}ms)\n`);
}

if (!mode) {
  process.exit(1);
}

if (withWorkers && webOnly) {
  process.stderr.write("[dev] --with-workers and --web-only cannot be combined\n");
  process.exit(1);
}

if (mode === "dev") process.env.INKVIA_RUNTIME_PROFILE = "local";
else if (mode === "build") process.env.INKVIA_RUNTIME_PROFILE = "build";
loadEnvConfig(process.cwd(), mode === "dev");

async function main() {
await prepareRuntime();

let distDir = ".next";
const distIdx = args.indexOf("--distDir");
if (distIdx !== -1) {
  distDir = args[distIdx + 1] || distDir;
  args.splice(distIdx, 2);
}

const nextEnv = {
  ...process.env,
  NEXT_DIST_DIR: distDir,
  ...(mode === "dev" && webOnly ? { INKVIA_DEV_WEB_ONLY: "1" } : {}),
};

if (mode === "dev") {
  const bundler = args.includes("--turbo") ? "turbopack" : "webpack";
  const devMode = webOnly ? "web-only" : withWorkers ? "full" : "web";
  process.stdout.write(`[dev] mode=${devMode} bundler=${bundler}\n`);
}

const nextBin = require.resolve("next/dist/bin/next");
const children = new Set();

function finishWhenStopped() {
  if (requestedExitCode !== null && children.size === 0) {
    process.exit(requestedExitCode);
  }
}

function shutdown(code) {
  if (requestedExitCode !== null) return;
  requestedExitCode = code;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 2_000).unref();
  finishWhenStopped();
}

function watch(child, onUnexpectedExit) {
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (requestedExitCode === null) onUnexpectedExit(code, signal);
    finishWhenStopped();
  });
}

const next = spawn(process.execPath, [nextBin, mode, ...args], {
  stdio: "inherit",
  env: nextEnv,
});

watch(next, (code) => shutdown(typeof code === "number" ? code : 1));

if (mode === "dev") {
  void warmDevRoutes().catch((error) => {
    process.stderr.write(`[dev] route warmup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  });
}

if (mode === "dev" && withWorkers) {
  const tsxBin = require.resolve("tsx/cli");
  const generationWorker = spawn(process.execPath, [
    tsxBin,
    "--conditions=react-server",
    "scripts/canvas-worker.ts",
    "--role=generation",
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      CANVAS_WORKER_INTERVAL_MS: process.env.CANVAS_WORKER_INTERVAL_MS || "500",
      CANVAS_WORKER_IDLE_LOG_MS: "30000",
    },
  });
  watch(generationWorker, (code, signal) => {
    process.stderr.write(`[canvas-generation-worker] exited unexpectedly (${signal || code || "unknown"})\n`);
    shutdown(typeof code === "number" && code !== 0 ? code : 1);
  });

  const mediaWorker = spawn(process.execPath, [
    tsxBin,
    "--conditions=react-server",
    "scripts/canvas-worker.ts",
    "--role=media",
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      CANVAS_WORKER_INTERVAL_MS: process.env.CANVAS_WORKER_INTERVAL_MS || "500",
      CANVAS_WORKER_IDLE_LOG_MS: "30000",
    },
  });
  watch(mediaWorker, (code, signal) => {
    process.stderr.write(`[canvas-media-worker] exited unexpectedly (${signal || code || "unknown"})\n`);
    shutdown(typeof code === "number" && code !== 0 ? code : 1);
  });

  const startImageBatchWorker = () => {
    const imageBatchWorker = spawn(process.execPath, [
      tsxBin,
      "--conditions=react-server",
      "scripts/image-batch-worker.ts",
    ], {
      stdio: "inherit",
      env: { ...process.env },
    });
    watch(imageBatchWorker, (code, signal) => {
      process.stderr.write(
        `[image-batch-worker] exited unexpectedly (${signal || code || "unknown"}), restarting\n`,
      );
      setTimeout(() => {
        if (requestedExitCode === null) startImageBatchWorker();
      }, 1_000).unref();
    });
  };

  startImageBatchWorker();

  const startLiveVideoPromptWorker = () => {
    const liveVideoPromptWorker = spawn(process.execPath, [
      tsxBin,
      "--conditions=react-server",
      "scripts/live-video-batch-worker.ts",
      "--role=prompt",
    ], {
      stdio: "inherit",
      env: { ...process.env },
    });
    watch(liveVideoPromptWorker, (code, signal) => {
      process.stderr.write(
        `[live-video-prompt-worker] exited unexpectedly (${signal || code || "unknown"}), restarting\n`,
      );
      setTimeout(() => {
        if (requestedExitCode === null) startLiveVideoPromptWorker();
      }, 1_000).unref();
    });
  };

  const startLiveVideoVideoWorker = () => {
    const liveVideoVideoWorker = spawn(process.execPath, [
      tsxBin,
      "--conditions=react-server",
      "scripts/live-video-batch-worker.ts",
      "--role=video",
    ], {
      stdio: "inherit",
      env: { ...process.env },
    });
    watch(liveVideoVideoWorker, (code, signal) => {
      process.stderr.write(
        `[live-video-video-worker] exited unexpectedly (${signal || code || "unknown"}), restarting\n`,
      );
      setTimeout(() => {
        if (requestedExitCode === null) startLiveVideoVideoWorker();
      }, 1_000).unref();
    });
  };

  startLiveVideoPromptWorker();
  startLiveVideoVideoWorker();
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
}
main().catch((error) => {
  process.stderr.write(`${error.code || "ENV_IDENTITY_UNVERIFIED"}\n`);
  process.exitCode = 1;
});
