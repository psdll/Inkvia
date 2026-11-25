import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("home page background UI", () => {
  it("does not render the fixed bottom gradient color block", () => {
    const source = readFileSync("components/home/home-page-client.tsx", "utf8");

    expect(source).not.toContain("meshBall");
    expect(source).not.toContain('bottom-[-18%] right-[7%] h-[420px] w-[420px]');
    expect(source).not.toContain('animation: "meshFloat');
  });
});
