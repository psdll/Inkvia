const canvasId = Number(process.argv[2]);
const repair = process.argv.includes("--repair");
if (!Number.isSafeInteger(canvasId) || canvasId < 1) {
  process.stderr.write("usage: npm run canvas:projection:rebuild -- <canvasId> [--repair]\n");
  process.exit(2);
}
const baseUrl = String(process.env.CANVAS_WORKER_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const token = String(process.env.CANVAS_WORKER_TOKEN || process.env.INTERNAL_METRICS_TOKEN || "").trim();
const response = await fetch(`${baseUrl}/api/internal/canvas-maintenance`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ action: "rebuild_projection", canvasId, repair }),
  signal: AbortSignal.timeout(180_000),
});
const text = await response.text();
process.stdout.write(`${text}\n`);
if (!response.ok) process.exit(1);
