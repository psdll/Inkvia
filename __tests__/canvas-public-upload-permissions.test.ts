import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import extraFs from "fs-extra";
import { saveLocalFile } from "@/lib/storage";

vi.mock("@/lib/runtime-isolation", async () => ({
  ...await vi.importActual("@/lib/runtime-isolation"),
  assertWritablePath: (await import("./helpers/fixture-storage-boundary")).assertFixtureStoragePath,
}));

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.skipIf(process.platform === "win32")("public canvas upload permissions", () => {
  it.each(["png", "mp4", "mp3"])("publishes %s readable by the separate web-server user", async ext => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-local-upload-"));
    await fs.chmod(root, 0o755);
    vi.stubEnv("UPLOADS_DIR", root);
    try {
      for (const method of ["link", "copy", "cross-device"] as const) {
        const source = path.join(root, `${method}.part`);
        await fs.writeFile(source, "validated synthetic media", { mode: 0o600 });
        expect((await fs.stat(source)).mode & 0o777).toBe(0o600);
        const link = method === "cross-device"
          ? vi.spyOn(extraFs, "link").mockRejectedValueOnce(Object.assign(new Error("cross device"), { code: "EXDEV" }))
          : null;
        const options = { stableKey: `synthetic-fixture-${method}`, fallbackExt: ext, dateSubdirectory: false,
          consumeSource: method !== "copy", publicReadable: true };
        const url = await saveLocalFile(source, "canvas_imports/test", options);
        link?.mockRestore();
        const target = path.join(root, url.slice("/uploads/".length));
        expect((await fs.stat(target)).mode & 0o777).toBe(0o644);
        expect(await fs.readFile(target, "utf8")).toBe("validated synthetic media");
        if (process.getuid?.() === 0) {
          expect(execFileSync("runuser", ["-u", "nobody", "--", "cat", target], { encoding: "utf8" }))
            .toBe("validated synthetic media");
        }
        // Re-upload repairs an existing 0600 object without replacing its bytes/inode.
        await fs.chmod(target, 0o600);
        const inode = (await fs.stat(target)).ino;
        await fs.writeFile(source, "different source");
        expect(await saveLocalFile(source, "canvas_imports/test", options)).toBe(url);
        expect((await fs.stat(target)).ino).toBe(inode);
        expect((await fs.stat(target)).mode & 0o777).toBe(0o644);
        expect(await fs.readFile(target, "utf8")).toBe("validated synthetic media");
      }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  it("keeps non-public file copies private", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-local-upload-"));
    vi.stubEnv("UPLOADS_DIR", root);
    try {
      const source = path.join(root, "private.part");
      await fs.writeFile(source, "private", { mode: 0o600 });
      const url = await saveLocalFile(source, "private", { fallbackExt: "bin" });
      expect((await fs.stat(path.join(root, url.slice("/uploads/".length)))).mode & 0o777).toBe(0o600);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
