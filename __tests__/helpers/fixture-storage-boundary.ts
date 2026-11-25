import os from "node:os";
import path from "node:path";
import { assertWritablePath, realTarget } from "../../scripts/lib/runtime-isolation.cjs";

// Retain the real path/junction guard while authorizing only these generated test folders.
export function assertFixtureStoragePath(target: string | URL | Buffer) {
  const value = target instanceof URL ? require("node:url").fileURLToPath(target) : String(target);
  const relative = path.relative(realTarget(os.tmpdir()), realTarget(value));
  const folder = relative.split(path.sep)[0];
  if (!/^(?:canvas-merchant-(?:day|source)|canvas-local-upload|provider-result-egress)-[A-Za-z0-9]+$/.test(folder)) throw new Error("UNAPPROVED_TEST_DIRECTORY");
  return assertWritablePath(target, { profile: "test", writableRoots: [path.join(realTarget(os.tmpdir()), folder)] } as any);
}
