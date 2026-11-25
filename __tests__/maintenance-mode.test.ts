import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicExport } from "./support/public-export";

const taskProbeMocks = vi.hoisted(() => ({
  admission: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/maintenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/maintenance")>();
  return { ...actual, assertDurableWorkAdmission: taskProbeMocks.admission };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: taskProbeMocks.transaction,
    adminJob: { findUnique: taskProbeMocks.findUnique },
  },
}));

import {
  DURABLE_TASK_MODELS,
  MAINTENANCE_SENTINEL_PATH,
  MaintenanceSubmissionError,
  createDurableTaskMaintenanceGuard,
  createDurableWorkAdmissionCheck,
  createBackgroundJobAdmissionCheck,
  runGenerationCompletionCreate,
  runUserImportRestoreCreate,
} from "@/lib/maintenance";
import {
  GET as rejectTaskProbeGet,
  OPTIONS as rejectTaskProbeOptions,
  POST as runTaskProbe,
} from "@/app/api/health/system-update-task-probe/route";

const creationOperations = ["create", "createMany", "createManyAndReturn", "upsert"] as const;

const taskProbeSecret = "p".repeat(64);
const taskProbeNonce = "0123456789abcdef0123456789abcdef";

function taskProbeRequest(options: { nonce?: string; proof?: string; body?: string } = {}) {
  const nonce = options.nonce ?? taskProbeNonce;
  const proof = options.proof ?? createHmac("sha256", taskProbeSecret)
    .update(`system-update-task-probe:${nonce}`)
    .digest("hex");
  return new NextRequest("http://127.0.0.1:3100/api/health/system-update-task-probe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-inkvia-system-update-proof": proof,
    },
    body: options.body ?? JSON.stringify({ nonce }),
  });
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("durable task maintenance guard", () => {
  it.skipIf(isPublicExport)("publishes nginx then business barriers and clears them in reverse order", () => {
    const packageRoot = resolve(process.cwd(), "config/deploy/server");
    const python = process.platform === "win32" ? "python" : "python3";
    const result = spawnSync(
      python,
      [
        "-c",
        String.raw`
import os, pathlib, sys, tempfile
sys.path.insert(0, sys.argv[1])
from inkvia_deploy.system import BarrierManager

with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    trace = []
    manager = BarrierManager(
        transaction_id="11111111-1111-4111-8111-111111111111",
        nginx_path=root / "nginx-maintenance",
        business_path=root / "maintenance",
        required_uid=os.getuid() if hasattr(os, "getuid") else 0,
        trace=trace.append,
    )
    manager.enter()
    assert trace == ["barrier:nginx:create", "barrier:business:create"]
    assert manager.nginx_path.is_file() and manager.business_path.is_file()
    assert manager.nginx_path.read_text("ascii") == "inkvia-deploy:nginx:11111111-1111-4111-8111-111111111111\n"
    manager.clear()
    assert trace[-2:] == ["barrier:business:clear", "barrier:nginx:clear"]
    assert not manager.nginx_path.exists() and not manager.business_path.exists()
`,
        packageRoot,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it("protects image batch outputs as durable background work", () => {
    expect(DURABLE_TASK_MODELS).toContain("ImageBatchOutput");
  });

  it.each(DURABLE_TASK_MODELS)("rejects every creation operation for %s while maintenance is active", async (model) => {
    for (const operation of creationOperations) {
      const statFile = vi.fn(async () => ({}));
      const query = vi.fn(async () => "created");
      const guard = createDurableTaskMaintenanceGuard(statFile);

      await expect(guard({ model, operation, args: {}, query })).rejects.toBeInstanceOf(
        MaintenanceSubmissionError,
      );
      expect(statFile).toHaveBeenCalledWith(MAINTENANCE_SENTINEL_PATH);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it.each(DURABLE_TASK_MODELS)("allows completion updates for %s during maintenance", async (model) => {
    const statFile = vi.fn(async () => ({}));
    const query = vi.fn(async () => "updated");
    const guard = createDurableTaskMaintenanceGuard(statFile);

    await expect(guard({ model, operation: "update", args: { where: { id: 1 } }, query }))
      .resolves.toBe("updated");
    expect(statFile).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
  });

  it("treats ENOENT as inactive and executes the creation", async () => {
    const statFile = vi.fn(async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    const query = vi.fn(async () => "created");
    const guard = createDurableTaskMaintenanceGuard(statFile);

    await expect(guard({ model: "Generation", operation: "create", args: {}, query }))
      .resolves.toBe("created");
    expect(query).toHaveBeenCalledOnce();
  });

  it("fails closed when the sentinel cannot be checked", async () => {
    const statFile = vi.fn(async () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    const query = vi.fn(async () => "created");
    const guard = createDurableTaskMaintenanceGuard(statFile);

    await expect(guard({ model: "AgentRun", operation: "create", args: {}, query }))
      .rejects.toBeInstanceOf(MaintenanceSubmissionError);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not consult maintenance state for unrelated models", async () => {
    const statFile = vi.fn(async () => ({}));
    const query = vi.fn(async () => "created");
    const guard = createDurableTaskMaintenanceGuard(statFile);

    await expect(guard({ model: "User", operation: "create", args: {}, query }))
      .resolves.toBe("created");
    expect(statFile).not.toHaveBeenCalled();
  });

  it("allows only Generation creates in the fixed generation-completion scope", async () => {
    const statFile = vi.fn(async () => ({}));
    const guard = createDurableTaskMaintenanceGuard(statFile);
    const generationQuery = vi.fn(async () => "completed");
    const agentQuery = vi.fn(async () => "expanded");

    await expect(runGenerationCompletionCreate(() => guard({
      model: "Generation",
      operation: "create",
      args: {},
      query: generationQuery,
    }))).resolves.toBe("completed");
    await expect(runGenerationCompletionCreate(() => guard({
      model: "AgentRun",
      operation: "create",
      args: {},
      query: agentQuery,
    }))).rejects.toBeInstanceOf(MaintenanceSubmissionError);
    expect(generationQuery).toHaveBeenCalledOnce();
    expect(agentQuery).not.toHaveBeenCalled();
  });

  it("allows only the protected restore models in the fixed user-import scope", async () => {
    const restorableModels = [
      "Generation",
      "AgentRun",
      "CanvasRun",
      "PromptReverseTask",
      "ImageBatchOutput",
    ];
    const guard = createDurableTaskMaintenanceGuard(vi.fn(async () => ({})));

    for (const model of restorableModels) {
      await expect(runUserImportRestoreCreate(() => guard({
        model,
        operation: "createMany",
        args: {},
        query: vi.fn(async () => model),
      }))).resolves.toBe(model);
    }
    await expect(runUserImportRestoreCreate(() => guard({
      model: "UserImportJob",
      operation: "create",
      args: {},
      query: vi.fn(async () => "new job"),
    }))).rejects.toBeInstanceOf(MaintenanceSubmissionError);
  });

  it("does not leak a completion capability to unrelated or later async work", async () => {
    const guard = createDurableTaskMaintenanceGuard(vi.fn(async () => ({})));
    let release!: () => void;
    const paused = new Promise<void>((resolvePaused) => { release = resolvePaused; });
    const trusted = runGenerationCompletionCreate(async () => {
      await paused;
      return guard({ model: "Generation", operation: "create", args: {}, query: vi.fn(async () => "trusted") });
    });

    await expect(guard({
      model: "Generation",
      operation: "create",
      args: {},
      query: vi.fn(async () => "untrusted"),
    })).rejects.toBeInstanceOf(MaintenanceSubmissionError);
    release();
    await expect(trusted).resolves.toBe("trusted");
    await expect(guard({
      model: "Generation",
      operation: "create",
      args: {},
      query: vi.fn(async () => "leaked"),
    })).rejects.toBeInstanceOf(MaintenanceSubmissionError);
  });

  it("rejects lifecycle admission while maintenance is active and fails closed", async () => {
    await expect(createDurableWorkAdmissionCheck(vi.fn(async () => ({})))())
      .rejects.toBeInstanceOf(MaintenanceSubmissionError);
    await expect(createDurableWorkAdmissionCheck(vi.fn(async () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    }))()).rejects.toBeInstanceOf(MaintenanceSubmissionError);
    await expect(createDurableWorkAdmissionCheck(vi.fn(async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }))()).resolves.toBeUndefined();
  });

  it("defers background jobs during maintenance and keeps a bootstrap retry", () => {
    const present = createBackgroundJobAdmissionCheck(() => ({}));
    const denied = createBackgroundJobAdmissionCheck(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    const missing = createBackgroundJobAdmissionCheck(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    expect(present()).toBe(false);
    expect(denied()).toBe(false);
    expect(missing()).toBe(true);

    const bootstrap = readFileSync(
      resolve(process.cwd(), "lib/server-bootstrap.ts"),
      "utf8",
    );
    const gate = bootstrap.indexOf("backgroundJobsAllowed()");
    const retry = bootstrap.indexOf("setTimeout(() => void startBackgroundJobs()");
    expect(gate).toBeGreaterThan(-1);
    expect(retry).toBeGreaterThan(gate);
    expect(gate).toBeLessThan(bootstrap.indexOf("setTimeout("));
    expect(gate).toBeLessThan(bootstrap.indexOf("setInterval("));
    expect(gate).toBeLessThan(bootstrap.indexOf("started = true"));
    expect(bootstrap).toMatch(
      /if\s*\(\s*!backgroundJobsAllowed\(\)\s*\)\s*\{[\s\S]*setTimeout\(\(\)\s*=>\s*void startBackgroundJobs\(\)[\s\S]*return[\s\S]*\}/,
    );
    expect(bootstrap.match(/backgroundJobsAllowed\(\)/g)).toHaveLength(1);
    expect(bootstrap).not.toMatch(/process\.env[\s\S]{0,200}background/i);

    const instrumentation = readFileSync(
      resolve(process.cwd(), "instrumentation.ts"),
      "utf8",
    );
    expect(instrumentation.match(/startBackgroundJobs\(\)/g)).toHaveLength(1);
    expect(instrumentation.match(/startUploadDiskMonitor\(\)/g)).toHaveLength(1);
    expect(instrumentation).toContain("readUploadDiskSnapshot");
    expect(instrumentation).not.toContain("usedRatio >= 0.7");
  });
});

describe("system update task probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SYSTEM_UPDATE_PROXY_PROOF = taskProbeSecret;
    taskProbeMocks.admission.mockResolvedValue(undefined);
    taskProbeMocks.create.mockResolvedValue({ jobId: `update-probe-${taskProbeNonce}` });
    taskProbeMocks.findUnique.mockResolvedValue(null);
    taskProbeMocks.transaction.mockImplementation(async (callback) => callback({
      adminJob: { create: taskProbeMocks.create },
    }));
  });

  it("rejects unsupported methods without checking maintenance or Prisma", async () => {
    const responses = await Promise.all([
      rejectTaskProbeGet(),
      rejectTaskProbeOptions(),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404]);
    expect(taskProbeMocks.admission).not.toHaveBeenCalled();
    expect(taskProbeMocks.transaction).not.toHaveBeenCalled();
    expect(taskProbeMocks.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{"],
    ["missing nonce", "{}"],
    ["uppercase nonce", JSON.stringify({ nonce: taskProbeNonce.toUpperCase() })],
    ["extra input", JSON.stringify({ nonce: taskProbeNonce, extra: true })],
  ])("rejects %s without checking maintenance or Prisma", async (_label, body) => {
    const response = await runTaskProbe(taskProbeRequest({ body }));

    expect(response.status).toBe(404);
    expect(taskProbeMocks.admission).not.toHaveBeenCalled();
    expect(taskProbeMocks.transaction).not.toHaveBeenCalled();
    expect(taskProbeMocks.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before checking maintenance or Prisma", async () => {
    const response = await runTaskProbe(taskProbeRequest({ proof: "0".repeat(64) }));

    expect(response.status).toBe(403);
    expect(taskProbeMocks.admission).not.toHaveBeenCalled();
    expect(taskProbeMocks.transaction).not.toHaveBeenCalled();
    expect(taskProbeMocks.findUnique).not.toHaveBeenCalled();
  });

  it("reports a controlled failure when durable work admission is closed", async () => {
    taskProbeMocks.admission.mockRejectedValue(new MaintenanceSubmissionError());

    const response = await runTaskProbe(taskProbeRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, code: "MAINTENANCE_ACTIVE" });
    expect(taskProbeMocks.transaction).not.toHaveBeenCalled();
    expect(taskProbeMocks.findUnique).not.toHaveBeenCalled();
  });

  it("creates a real AdminJob through the central Prisma client and rolls it back", async () => {
    const response = await runTaskProbe(taskProbeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(taskProbeMocks.admission).toHaveBeenCalledOnce();
    expect(taskProbeMocks.create).toHaveBeenCalledWith({
      data: {
        jobId: `update-probe-${taskProbeNonce}`,
        type: "system_update_probe",
        status: "probe",
        progress: 0,
        payload: { nonce: taskProbeNonce },
      },
    });
    expect(taskProbeMocks.findUnique).toHaveBeenCalledWith({
      where: { jobId: `update-probe-${taskProbeNonce}` },
      select: { jobId: true },
    });
  });

  it("fails closed if rollback residue is observable", async () => {
    taskProbeMocks.findUnique.mockResolvedValue({ jobId: `update-probe-${taskProbeNonce}` });

    const response = await runTaskProbe(taskProbeRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, code: "TASK_PROBE_FAILED" });
  });
});

describe("durable task creation coverage contract", () => {
  it("keeps runtime Prisma access on the centrally extended singleton", () => {
    const roots = [resolve(process.cwd(), "app"), resolve(process.cwd(), "lib")];
    const constructors = roots.flatMap(sourceFiles).filter((file) =>
      /new\s+PrismaClient\s*\(/.test(readFileSync(file, "utf8")),
    );
    const prismaSource = readFileSync(resolve(process.cwd(), "lib/prisma.ts"), "utf8");
    expect(constructors).toEqual([resolve(process.cwd(), "lib/prisma.ts")]);
    expect(prismaSource).toContain("$extends");
    expect(prismaSource).toContain("$allModels");
    expect(prismaSource).toContain("$allOperations");
    expect(prismaSource).toContain("durableTaskMaintenanceGuard");
  });

  it("forbids raw and nested creation paths that bypass query extensions", () => {
    const runtimeSource = [resolve(process.cwd(), "app"), resolve(process.cwd(), "lib")]
      .flatMap(sourceFiles)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const modelAlternation = DURABLE_TASK_MODELS.join("|");
    expect(runtimeSource).not.toMatch(
      new RegExp(`INSERT\\s+INTO\\s+[\"']?(?:${modelAlternation})(?:[\"']|\\b)`, "i"),
    );
    expect(runtimeSource).not.toMatch(/INSERT\s+INTO\s+\$\{/i);
    for (const relation of ["generations", "canvasRuns", "promptReverseTasks"]) {
      expect(runtimeSource).not.toMatch(
        new RegExp(`\\b${relation}\\s*:\\s*\\{[\\s\\S]{0,500}\\b(?:create|createMany|connectOrCreate|upsert)\\s*:`),
      );
    }
  });

  it("keeps trusted completion entry points fixed and bound to existing work", () => {
    const maintenance = readFileSync(resolve(process.cwd(), "lib/maintenance.ts"), "utf8");
    const allSources = [resolve(process.cwd(), "app"), resolve(process.cwd(), "lib")]
      .flatMap(sourceFiles)
      .map((file) => ({ file, source: readFileSync(file, "utf8") }));
    const generationCallers = allSources
      .filter(({ file, source }) => !file.endsWith("maintenance.ts") && source.includes("runGenerationCompletionCreate"))
      .map(({ file }) => file.replace(process.cwd(), "").replaceAll("\\", "/"))
      .sort();
    const importCallers = allSources
      .filter(({ file, source }) => !file.endsWith("maintenance.ts") && source.includes("runUserImportRestoreCreate"))
      .map(({ file }) => file.replace(process.cwd(), "").replaceAll("\\", "/"));

    expect(maintenance).not.toContain("process.env");
    expect(maintenance).not.toMatch(/export\s+function\s+runTrusted/);
    expect(generationCallers).toEqual([
      "/lib/generation/claim-lease.ts",
      "/lib/generation/image-service.ts",
    ]);
    expect(importCallers).toEqual(["/lib/admin/user-import-runner.ts"]);
    const claimLease = readFileSync(resolve(process.cwd(), "lib/generation/claim-lease.ts"), "utf8");
    const imageService = readFileSync(resolve(process.cwd(), "lib/generation/image-service.ts"), "utf8");
    expect(claimLease.lastIndexOf("runGenerationCompletionCreate")).toBeGreaterThan(claimLease.indexOf("if (!touched.count)"));
    expect(claimLease.lastIndexOf("runGenerationCompletionCreate")).toBeLessThan(claimLease.indexOf("const metadata ="));
    expect(imageService.lastIndexOf("runGenerationCompletionCreate")).toBeGreaterThan(imageService.indexOf("const activeParent ="));
    const importRunner = readFileSync(resolve(process.cwd(), "lib/admin/user-import-runner.ts"), "utf8");
    expect(importRunner.lastIndexOf("runUserImportRestoreCreate"))
      .toBeGreaterThan(importRunner.indexOf("const claim = await importJobModel().updateMany"));
  });

  it("gates terminal-to-active retry transitions before their mutations", () => {
    for (const file of [
      "lib/admin/user-import-runner.ts",
    ]) {
      const contents = readFileSync(resolve(process.cwd(), file), "utf8");
      const admission = contents.lastIndexOf("await assertDurableWorkAdmission()");
      expect(admission).toBeGreaterThan(-1);
      expect(admission).toBeLessThan(contents.lastIndexOf(".update"));
    }
    const batchSubmission = readFileSync(
      resolve(process.cwd(), "lib/image-batch/submission.ts"),
      "utf8",
    );
    for (const [startToken, endToken] of [
      ["export async function submitImageBatch", "export async function retryFailedBatchOutputs"],
      ["export async function retryFailedBatchOutputs", "export async function cancelQueuedBatchOutputs"],
    ]) {
      const start = batchSubmission.indexOf(startToken);
      const end = batchSubmission.indexOf(endToken, start + startToken.length);
      const operation = batchSubmission.slice(start, end);
      const admission = operation.indexOf("await assertDurableWorkAdmission()");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(admission).toBeGreaterThan(-1);
      expect(admission).toBeLessThan(operation.indexOf(".createMany"));
    }
    const canvasRunRoute = readFileSync(
      resolve(process.cwd(), "app/api/canvas/runs/[runId]/route.ts"),
      "utf8",
    );
    expect(canvasRunRoute).toContain('body?.action !== "cancel"');
    expect(canvasRunRoute).not.toMatch(/\b(?:retry|reactivate|resume)\b/i);
  });
});
