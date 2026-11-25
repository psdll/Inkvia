import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, HEAD } from "@/app/api/uploads/[...path]/route";

afterEach(() => vi.unstubAllEnvs());

describe("uploaded canvas media serving", () => {
  it.each([["png", "image/png"], ["mp4", "video/mp4"], ["mp3", "audio/mpeg"]])(
    "serves %s original, HEAD and byte ranges from a Chinese merchant folder", async (ext, mime) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-local-upload-"));
      vi.stubEnv("UPLOADS_DIR", root);
      try {
        const segments = ["canvas_imports", "测试_20260925", `synthetic.${ext}`];
        await fs.mkdir(path.join(root, ...segments.slice(0, -1)), { recursive: true });
        await fs.writeFile(path.join(root, ...segments), "synthetic media bytes", { mode: 0o600 });
        const url = `http://localhost/api/uploads/${segments.map(encodeURIComponent).join("/")}`;
        const context = { params: { path: segments } };
        const head = await HEAD(new NextRequest(url, { method: "HEAD" }), context);
        expect(head.status).toBe(200);
        expect(head.headers.get("content-type")).toBe(mime);
        const full = await GET(new NextRequest(url), context);
        expect(full.status).toBe(200);
        expect(await full.text()).toBe("synthetic media bytes");
        const range = await GET(new NextRequest(url, { headers: { range: "bytes=0-0" } }), context);
        expect(range.status).toBe(206);
        expect(range.headers.get("content-range")).toBe("bytes 0-0/21");
        expect(await range.text()).toBe("s");
      } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
});
