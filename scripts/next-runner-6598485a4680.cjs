const { spawn } = require("child_process");

const mode = process.argv[2];
const args = process.argv.slice(3);

if (!mode) {
  process.exit(1);
}

let distDir = ".next";
const distIdx = args.indexOf("--distDir");
if (distIdx !== -1) {
  distDir = args[distIdx + 1] || distDir;
  args.splice(distIdx, 2);
}

const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, mode, ...args], {
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: distDir }
});

child.on("exit", (code) => {
  process.exit(typeof code === "number" ? code : 0);
});
