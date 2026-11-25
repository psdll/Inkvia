import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildProxyOverrideCandidate, buildProxySafeView, resolveProviderProxyFromRaw } from "@/lib/providers/proxy-config";
import { buildAxiosRequestConfig, createProviderEgressDecision } from "@/lib/providers/transport";

const { parseSystemProxy } = createRequire(import.meta.url)("../desktop/lib/system-proxy.cjs");
let temp = "";
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = "";
  vi.unstubAllEnvs();
});

describe("Electron system proxy result", () => {
  it.each([
    ["PROXY 127.0.0.1:10808", { status: "proxy", url: "http://127.0.0.1:10808" }],
    ["HTTPS [::1]:8888", { status: "proxy", url: "https://[::1]:8888" }],
    ["SOCKS5 localhost:7890", { status: "socks" }],
    ["DIRECT", { status: "direct" }],
    ["SOCKS4 my-proxy:1080; PROXY proxy2:8080; DIRECT", { status: "proxy", url: "http://proxy2:8080" }],
    ["SOCKS5 localhost:7890; DIRECT", { status: "socks" }],
    ["DIRECT; PROXY proxy2:8080", { status: "direct" }],
    ["PROXY localhost:65536; DIRECT", { status: "direct" }],
    ["PROXY user:password@localhost:8888", { status: "unavailable" }],
  ])("interprets %s", (result, expected) => {
    expect(parseSystemProxy(result)).toEqual(expected);
  });
});

function environment(status: object) {
  temp = mkdtempSync(join(tmpdir(), "inkvia-18-proxy-"));
  const file = join(temp, "system-proxy.json");
  writeFileSync(file, JSON.stringify(status));
  vi.stubEnv("INKVIA_DESKTOP_MODE", "1");
  return { INKVIA_DESKTOP_MODE: "1", INKVIA_DESKTOP_PROXY_FILE: file };
}

describe("desktop proxy routing", () => {
  const provider = { id: "apimart", egressMode: "proxy" as const, baseUrl: "https://example.com" };

  it("defaults to system and keeps explicit custom and environment overrides", () => {
    const env = { ...environment({ status: "proxy", url: "http://127.0.0.1:10808" }), HTTPS_PROXY: "http://env.test:3128" };
    const resolve = (raw: string | null) => resolveProviderProxyFromRaw(provider.id, raw, env);
    expect(resolve(null)).toMatchObject({ source: "system", uri: "http://127.0.0.1:10808" });
    expect(buildProxySafeView(null, env)).toMatchObject({ overrideState: "system", source: "system" });
    const inherit = buildProxyOverrideCandidate(null, { action: "inherit" });
    expect(resolve(inherit)).toMatchObject({ source: "environment" });
    expect(resolveProviderProxyFromRaw(provider.id, inherit, { ...env, HTTPS_PROXY: "" }).source).toBe("system");
    expect(resolve(buildProxyOverrideCandidate(null, { action: "set", url: "http://custom.test:3128" }))).toMatchObject({ source: "database" });
    expect(resolve(buildProxyOverrideCandidate(null, { action: "disable" })).status).toBe("missing");
    expect(buildProxyOverrideCandidate(inherit, { action: "system" })).toBeNull();
    expect(resolveProviderProxyFromRaw(provider.id, null, { ...env, INKVIA_DESKTOP_MODE: "0" }).source).toBe("environment");
  });

  it("uses direct transport when Electron detects DIRECT", () => {
    const env = environment({ status: "direct" });
    expect(createProviderEgressDecision(provider, resolveProviderProxyFromRaw(provider.id, null, env)).mode).toBe("direct");
  });

  it("reports SOCKS without silently using direct transport", () => {
    const env = environment({ status: "socks" });
    expect(buildProxySafeView(null, env).system).toEqual({ status: "socks" });
    expect(() => createProviderEgressDecision(provider, resolveProviderProxyFromRaw(provider.id, null, env))).toThrow("代理配置无效");
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("always bypasses the proxy for %s in desktop mode", host => {
    const env = environment({ status: "proxy", url: "http://127.0.0.1:10808" });
    const url = `http://${host}:1234`;
    const proxy = resolveProviderProxyFromRaw(provider.id, null, env);
    expect(createProviderEgressDecision({ ...provider, baseUrl: url }, proxy).mode).toBe("direct");
    const decision = createProviderEgressDecision(provider, proxy);
    expect(buildAxiosRequestConfig(decision, { url }).httpAgent.constructor.name).toBe("Agent");
  });
});
