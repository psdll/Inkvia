const workers = [
  { name: "image-batch-worker", script: ".next/standalone/scripts/image-batch-worker.mjs", args: [] },
  { name: "canvas-generation-worker", resident: true, script: ".next/standalone/scripts/canvas-worker.mjs", args: ["--role=generation"] },
  { name: "canvas-media-worker", resident: true, script: ".next/standalone/scripts/canvas-worker.mjs", args: ["--role=media"] },
  { name: "live-video-prompt-worker", script: ".next/standalone/scripts/live-video-batch-worker.mjs", args: ["--role=prompt"] },
  { name: "live-video-video-worker", script: ".next/standalone/scripts/live-video-batch-worker.mjs", args: ["--role=video"] },
];
module.exports = workers;
