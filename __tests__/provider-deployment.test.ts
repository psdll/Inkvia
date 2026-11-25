import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicExport } from "./support/public-export";

describe("provider egress deployment baseline", () => {
  it("pins the supported Node baseline and runtime transport dependencies", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    expect(pkg.engines?.node).toBe(">=18.17.0");
    expect(pkg.dependencies).toMatchObject({
      undici: "^6.27.0",
      "http-proxy-agent": "^7.0.2",
      "https-proxy-agent": "^7.0.6",
    });
  });

  it("checks Node before deployment and documents the proxy safety constraints", () => {
    const preflight = readFileSync(resolve(process.cwd(), "scripts/deploy-preflight.mjs"), "utf8");
    const nextConfig = readFileSync(resolve(process.cwd(), "next.config.js"), "utf8");

    expect(preflight).toContain("18, 17, 0");
    expect(preflight).toContain("Node.js >= 18.17.0");
    expect(nextConfig).toContain('output: "standalone"');
    if (isPublicExport) return;
    const guide = readFileSync(resolve(process.cwd(), "docs/provider-egress-deployment.md"), "utf8");
    for (const phrase of ["TUN", "127.0.0.1", "数据库文件和备份", "HTTP_PROXY/HTTPS_PROXY", "sidecar"]) {
      expect(guide).toContain(phrase);
    }
  });
});
