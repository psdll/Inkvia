import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("tool video request-key idempotency", () => {
  it("sends one stable submission key and blocks concurrent browser submits", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/video/video-tool.tsx"), "utf8");

    expect(source).toContain("const generationSubmitInFlightRef = React.useRef(false)");
    expect(source).toContain("if (generationSubmitInFlightRef.current) return");
    expect(source).toContain('addPendingItem("video_gen", requestKey,');
    expect(source).toContain('form.set("requestKey", requestKey)');
    expect(source).toContain("generationSubmitInFlightRef.current = false");
  });
});
