import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8"));
const runner = readFileSync("scripts/next-runner.cjs", "utf8");
const canvasWorker = readFileSync("scripts/canvas-worker.ts", "utf8");
const nodeRequire = createRequire(import.meta.url);

function loadNextConfig(nodeEnv: "development" | "production") {
  const configPath = nodeRequire.resolve(resolve(process.cwd(), "next.config.js"));
  const environment = process.env as Record<string, string | undefined>;
  const previousNodeEnv = environment.NODE_ENV;
  environment.NODE_ENV = nodeEnv;
  delete nodeRequire.cache[configPath];

  try {
    return nodeRequire(configPath);
  } finally {
    delete nodeRequire.cache[configPath];
    if (previousNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnv;
  }
}

describe("local development performance modes", () => {
  it("uses Web-only development by default and keeps an explicit full mode", () => {
    expect(pkg.scripts.dev).toContain("--web-only");
    expect(pkg.scripts.dev).not.toContain("--with-workers");
    expect(pkg.scripts.dev).not.toContain("--turbo");
    expect(pkg.scripts["dev:web"]).toContain("--web-only");
    expect(pkg.scripts["dev:web"]).not.toContain("--turbo");
    expect(pkg.scripts["dev:full"]).toContain("--with-workers");
    expect(pkg.scripts["dev:full"]).not.toContain("--web-only");
    expect(pkg.scripts["dev:full"]).not.toContain("--turbo");
    expect(pkg.scripts["dev:webpack"]).toContain("--with-workers");
    expect(pkg.scripts["dev:webpack"]).not.toContain("--turbo");
    expect(tsconfig.include).toEqual(expect.arrayContaining([
      ".next-dev-web/types/**/*.ts",
      ".next-dev-webpack/types/**/*.ts",
    ]));
  });

  it("consumes local-only flags before starting Next.js", () => {
    expect(runner).toContain('consumeFlag("--with-workers")');
    expect(runner).toContain('consumeFlag("--web-only")');
    expect(runner).toContain('INKVIA_DEV_WEB_ONLY: "1"');
    expect(runner).toContain('CANVAS_WORKER_IDLE_LOG_MS: "30000"');
  });

  it("warms common workspace routes after the local Web server starts", () => {
    expect(runner).toContain("warmDevRoutes");
    expect(runner).toContain("Promise.all");
    expect(runner).toContain('"/studio"');
    expect(runner).toContain('"/batch-workbench"');
    expect(runner).toContain('"/works"');
    expect(runner).toContain('"/materials"');
    expect(runner).toContain('"/settings"');
    expect(runner).toContain('"/canvas"');
    expect(runner).toContain('"/api/auth/me"');
    expect(runner).toContain('"/api/auth/me/stats"');
    expect(runner).toContain('"/api/material-assets/upload-permission"');
    expect(runner).toContain('"/api/material-assets?page=1&pageSize=1&status=all"');
  });

  it("externalizes Node-only tracing packages only during development", () => {
    const developmentConfig = loadNextConfig("development");
    const productionConfig = loadNextConfig("production");

    expect(
      developmentConfig.experimental?.serverComponentsExternalPackages,
    ).toContain("@opentelemetry/auto-instrumentations-node");
    expect(
      developmentConfig.experimental?.serverComponentsExternalPackages,
    ).toContain("ali-oss");
    const productionExternals = productionConfig.experimental?.serverComponentsExternalPackages;
    expect(productionExternals).not.toContain("@opentelemetry/auto-instrumentations-node");
    expect(productionExternals).not.toContain("ali-oss");
    expect(productionExternals).toEqual(expect.arrayContaining([
      "@earendil-works/pi-ai", "@earendil-works/pi-agent-core",
    ]));
    expect(developmentConfig.onDemandEntries).toEqual({
      maxInactiveAge: 30 * 60 * 1000,
      pagesBufferLength: 12,
    });
    expect(productionConfig).not.toHaveProperty("onDemandEntries");
  });

  it("throttles idle Canvas worker logs only when the runner opts in", () => {
    expect(canvasWorker).toContain("CANVAS_WORKER_IDLE_LOG_MS");
    expect(canvasWorker).toContain("hasPositiveNumber");
    expect(canvasWorker).toContain("lastWorkerLogAt");
    expect(canvasWorker).toContain("idleLogIntervalMs === 0");
  });
});
