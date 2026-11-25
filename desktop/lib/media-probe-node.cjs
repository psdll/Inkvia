// The web service deliberately starts this probe with a minimal environment.
// Its process.execPath is Electron, so preserve Node mode for this one child.
const cp = require("node:child_process");
const path = require("node:path");
const probe = path.join(process.cwd(), "scripts", "canvas-media-probe.mjs");
const spawn = cp.spawn;
cp.spawn = function (command, args, options) {
  if (command === process.execPath && args?.[0] === probe && args[1] === "--worker") {
    options = { ...options, env: { ...options.env, ELECTRON_RUN_AS_NODE: "1" } };
  }
  return spawn.call(this, command, args, options);
};
require("node:module").syncBuiltinESMExports();
