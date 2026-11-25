import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { UploadKind } from "@/lib/upload-validation";
import type { CanvasMediaProbe } from "./media-security";

type Job = { filePath: string; kind: UploadKind; resolve: (result: CanvasMediaProbe) => void; reject: (error: Error) => void };
type Worker = { child: ChildProcessWithoutNullStreams; job?: Job; timer?: NodeJS.Timeout; output: string; used: number };
const workers = new Set<Worker>();
const pending: Job[] = [];
const MAX_WORKERS = 4;

function stop(worker: Worker, error?: Error) {
  if (!workers.delete(worker)) return;
  clearTimeout(worker.timer);
  const job = worker.job;
  worker.job = undefined;
  worker.child.kill();
  job?.reject(error || new Error("media probe worker stopped"));
  dispatch();
}

function createWorker(): Worker {
  const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", "canvas-media-probe.mjs"), "--worker"], {
    windowsHide: true,
    stdio: "pipe",
    env: { PATH: process.env.PATH || "", NODE_PATH: process.env.NODE_PATH || "", NODE_ENV: process.env.NODE_ENV },
  });
  const worker: Worker = { child, output: "", used: 0 };
  workers.add(worker);
  child.on("error", error => stop(worker, error));
  child.on("exit", () => stop(worker, new Error("media probe worker exited")));
  child.stdin.on("error", error => stop(worker, error));
  child.stderr.resume();
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    worker.output += chunk;
    if (worker.output.length > 2 * 1024 * 1024) return stop(worker, new Error("media probe output too large"));
    if (!worker.output.includes("\n")) return;
    const job = worker.job;
    if (!job) return stop(worker, new Error("unexpected media probe response"));
    clearTimeout(worker.timer);
    try {
      const response = JSON.parse(worker.output);
      worker.output = "";
      if (response.error || response.result?.kind !== job.kind) throw new Error(response.error || "media probe kind mismatch");
      worker.job = undefined;
      job.resolve(response.result);
      // Periodically recycle native decoders; do not leave idle processes running.
      if (++worker.used >= 100) return stop(worker);
      worker.timer = setTimeout(() => stop(worker), 5_000);
      worker.timer.unref();
      dispatch();
    } catch (error) { stop(worker, error instanceof Error ? error : new Error("invalid media probe response")); }
  });
  return worker;
}

function dispatch() {
  while (pending.length) {
    const worker = [...workers].find(candidate => !candidate.job)
      || (workers.size < MAX_WORKERS ? createWorker() : undefined);
    if (!worker) return;
    clearTimeout(worker.timer);
    worker.job = pending.shift()!;
    worker.timer = setTimeout(() => stop(worker, new Error("media probe timed out")), 30_000);
    worker.child.stdin.write(JSON.stringify({ filePath: worker.job.filePath, kind: worker.job.kind }) + "\n");
  }
}

export function probeCanvasMediaPooled(filePath: string, kind: UploadKind): Promise<CanvasMediaProbe> {
  return new Promise((resolve, reject) => { pending.push({ filePath, kind, resolve, reject }); dispatch(); });
}
