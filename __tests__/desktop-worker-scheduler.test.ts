import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createWorkerScheduler } = require("../desktop/lib/worker-scheduler.cjs");
const workers = require("../desktop/lib/workers.cjs") as { name: string; resident?: boolean }[];
const resident = ["canvas-generation-worker", "canvas-media-worker"];
const image = "image-batch-worker";

function setup() {
  let time = 0;
  const exits = new Map<string, (code: number) => void>();
  const drain = vi.fn(() => true);
  const launch = vi.fn(({ name }: { name: string }) => ({
    drain,
    done: new Promise<number>(resolve => exits.set(name, resolve)),
  }));
  const report = vi.fn();
  const scheduler: { reconcile: (pending: Record<string, boolean>) => void; stop: () => void } =
    createWorkerScheduler(workers, { launch, report, now: () => time });
  return { ...scheduler, launch, drain, report, exits, advance: (ms: number) => { time += ms; } };
}

describe("desktop worker scheduling", () => {
  it("starts only the resident canvas workers when queues are empty", () => {
    const scheduler = setup();
    scheduler.reconcile({});
    scheduler.advance(600_000);
    scheduler.reconcile({});
    expect(scheduler.launch.mock.calls.map(([worker]) => worker.name)).toEqual(resident);
    expect(scheduler.drain).not.toHaveBeenCalled();
  });

  it.each(workers.filter(worker => !worker.resident).map(worker => worker.name))(
    "recovers %s on the first poll and never starts a duplicate",
    name => {
      const scheduler = setup();
      scheduler.reconcile({ [name]: true });
      scheduler.reconcile({ [name]: true });
      expect(scheduler.launch.mock.calls.map(([worker]) => worker.name).sort()).toEqual([...resident, name].sort());
    },
  );

  it("drains after five idle minutes and restarts for work arriving during drain", async () => {
    const scheduler = setup();
    scheduler.reconcile({});
    scheduler.reconcile({ [image]: true });
    scheduler.advance(299_999);
    scheduler.reconcile({});
    expect(scheduler.drain).not.toHaveBeenCalled();
    scheduler.advance(1);
    scheduler.reconcile({});
    expect(scheduler.drain).toHaveBeenCalledTimes(1);
    scheduler.reconcile({ [image]: true });
    expect(scheduler.launch).toHaveBeenCalledTimes(3);
    scheduler.exits.get(image)?.(0);
    await Promise.resolve();
    scheduler.reconcile({ [image]: true });
    expect(scheduler.launch).toHaveBeenCalledTimes(4);
  });

  it("never drains while work is pending and suspends crash retries at the cap", async () => {
    const scheduler = setup();
    for (let attempt = 0; attempt < 5; attempt++) {
      scheduler.reconcile({ [image]: true });
      scheduler.exits.get(image)?.(1);
      await Promise.resolve();
      scheduler.advance(5000);
    }
    scheduler.advance(600_000);
    scheduler.reconcile({ [image]: true });
    expect(scheduler.launch.mock.calls.filter(([worker]) => worker.name === image)).toHaveLength(5);
    expect(scheduler.drain).not.toHaveBeenCalled();
    expect(scheduler.report).toHaveBeenCalledTimes(1);
  });

  it("delivers the drain inside the child and lets the in-flight batch finish", async () => {
    const control = resolve(process.cwd(), "desktop/lib/worker-control.cjs");
    const child = spawn(process.execPath, ["--require", control, "-e", `
      const active = setTimeout(() => process.exit(2), 1000);
      process.once('SIGTERM', () => {
        clearTimeout(active);
        setTimeout(() => console.log('batch finished'), 30);
      });
      process.send('busy');
    `], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
      let output = "";
      child.stdout!.on("data", chunk => { output += chunk; });
      child.once("error", reject);
      child.once("message", () => child.send("desktop:worker-idle"));
      child.once("close", code => done({ code, output }));
    });
    expect(result).toEqual({ code: 0, output: "batch finished\n" });
  });
});
