import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { performance } from "node:perf_hooks";

const SCENARIOS = {
  normal: { rps: 20, durationSeconds: 60, p95Ms: 300, allow429: false },
  peak: { rps: 100, durationSeconds: 60, p95Ms: 500, allow429: false },
  stress: { rps: 500, durationSeconds: 60, p95Ms: 1_500, allow429: false },
  overload: { rps: 1_000, durationSeconds: 60, p95Ms: Infinity, allow429: true },
};

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

const scenarioName = argument("scenario", "normal");
const scenario = SCENARIOS[scenarioName];
if (!scenario) throw new Error(`Unknown scenario: ${scenarioName}`);
const baseUrl = argument("base-url", process.env.CANVAS_LOAD_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const actorsPath = argument("actors", process.env.CANVAS_LOAD_ACTORS_FILE || "");
if (!actorsPath) throw new Error("Provide --actors=<json file>; credentials are never accepted on the command line");
const durationSeconds = Math.max(1, Number(argument("duration", scenario.durationSeconds)) || scenario.durationSeconds);
const actorInputs = JSON.parse(await readFile(actorsPath, "utf8"));
if (!Array.isArray(actorInputs) || !actorInputs.length) throw new Error("Actor file must contain a non-empty JSON array");

const actors = actorInputs.map((input, index) => {
  if (!Number.isSafeInteger(input.canvasId) || input.canvasId <= 0 || typeof input.nodeId !== "string" || !input.nodeId) {
    throw new Error(`Actor ${index} must define canvasId and nodeId`);
  }
  return {
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    cookie: String(input.cookie || ""),
    revision: String(input.baseRevision ?? "0"),
    sequence: Number(input.clientSequence || 0),
    busy: false,
  };
});

const stats = {
  offered: 0,
  completed: 0,
  clientDropped: 0,
  conflicts: 0,
  overloaded: 0,
  serverErrors: 0,
  otherErrors: 0,
  readFailures: 0,
  missingRetryAfter: 0,
  latencies: [],
  statuses: new Map(),
};
const active = new Set();
let actorCursor = 0;
let stopped = false;

function recordLatency(value) {
  const limit = 20_000;
  if (stats.latencies.length < limit) stats.latencies.push(value);
  else stats.latencies[stats.completed % limit] = value;
}

async function mutate(actor) {
  actor.busy = true;
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/canvas/${actor.canvasId}/mutations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(actor.cookie ? { Cookie: actor.cookie } : {}),
      },
      body: JSON.stringify({
        protocolVersion: 1,
        clientMutationId: randomUUID(),
        clientSequence: actor.sequence,
        baseRevision: actor.revision,
        operations: [{
          opId: randomUUID(),
          kind: "node.move",
          nodeId: actor.nodeId,
          position: { x: actor.sequence % 10_000, y: Math.floor(actor.sequence / 10_000) % 10_000 },
        }],
      }),
    });
    const payload = await response.json().catch(() => null);
    stats.statuses.set(response.status, (stats.statuses.get(response.status) || 0) + 1);
    if (response.ok && payload?.success && typeof payload.revision === "string") {
      if (BigInt(payload.revision) <= BigInt(actor.revision)) stats.otherErrors += 1;
      else actor.revision = payload.revision;
      actor.sequence += 1;
    } else if (response.status === 409 && payload?.code === "CANVAS_REVISION_CONFLICT") {
      stats.conflicts += 1;
      if (typeof payload.currentRevision === "string") actor.revision = payload.currentRevision;
    } else if (response.status === 429) {
      stats.overloaded += 1;
      if (!response.headers.get("Retry-After")) stats.missingRetryAfter += 1;
    } else if (response.status >= 500) stats.serverErrors += 1;
    else stats.otherErrors += 1;
  } catch {
    stats.otherErrors += 1;
  } finally {
    stats.completed += 1;
    recordLatency(performance.now() - startedAt);
    actor.busy = false;
  }
}

async function probeRead() {
  const actor = actors[actorCursor % actors.length];
  try {
    const response = await fetch(`${baseUrl}/api/canvas/${actor.canvasId}/bootstrap?nodeLimit=1&edgeLimit=1`, {
      headers: actor.cookie ? { Cookie: actor.cookie } : {},
    });
    if (!response.ok) stats.readFailures += 1;
  } catch {
    stats.readFailures += 1;
  }
}

const intervalMs = 1_000 / scenario.rps;
let nextAt = performance.now();
const scheduler = setInterval(() => {
  const now = performance.now();
  while (!stopped && nextAt <= now) {
    stats.offered += 1;
    const actor = actors[actorCursor % actors.length];
    actorCursor += 1;
    if (actor.busy) {
      stats.clientDropped += 1;
    } else {
      const request = mutate(actor).finally(() => active.delete(request));
      active.add(request);
    }
    nextAt += intervalMs;
  }
}, Math.max(1, Math.min(intervalMs, 10)));
const readProbe = setInterval(() => { void probeRead(); }, 1_000);
await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1_000));
stopped = true;
clearInterval(scheduler);
clearInterval(readProbe);
await Promise.all(active);

const result = {
  scenario: scenarioName,
  targetRps: scenario.rps,
  durationSeconds,
  actorStreams: actors.length,
  ...stats,
  statuses: Object.fromEntries([...stats.statuses].sort(([left], [right]) => left - right)),
  latencies: undefined,
  achievedRps: stats.completed / durationSeconds,
  p50Ms: percentile(stats.latencies, 0.5),
  p95Ms: percentile(stats.latencies, 0.95),
  p99Ms: percentile(stats.latencies, 0.99),
};
console.log(JSON.stringify(result, null, 2));

const excessiveClientDrops = stats.clientDropped > Math.max(1, stats.offered * 0.01);
const failed = stats.serverErrors > 0
  || stats.otherErrors > 0
  || stats.readFailures > 0
  || stats.missingRetryAfter > 0
  || (!scenario.allow429 && stats.overloaded > 0)
  || (!scenario.allow429 && stats.conflicts > 0)
  || result.p95Ms > scenario.p95Ms
  || excessiveClientDrops;
if (failed) process.exitCode = 1;
