import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Agent, ProxyAgent } from "undici";
import {
  ProviderNetworkError,
  buildAxiosRequestConfig,
  buildFetchRequestInit,
  buildProxyAgentOptions,
  createProviderEgressDecision,
} from "@/lib/providers/transport";

const readyProxy = {
  status: "ready" as const,
  source: "database" as const,
  uri: "http://127.0.0.1:7890",
  token: "Basic dXNlcjpwYXNz",
  preview: "http://127.0.0.1:7890",
  hasCredentials: true,
  fingerprint: "proxy-fingerprint",
};

describe("provider transport decisions", () => {
  it("forces direct even when proxy environment exists", () => {
    process.env.HTTPS_PROXY = "http://trap.invalid:9999";
    const decision = createProviderEgressDecision({ id: "kie", egressMode: "direct" }, readyProxy);
    const fetchInit = buildFetchRequestInit(decision, { method: "GET" });
    const axiosConfig = buildAxiosRequestConfig(decision, {
      url: "https://api.kie.ai/test",
      proxy: { host: "trap.invalid", port: 9999 },
    });

    expect(fetchInit.dispatcher).toBeInstanceOf(Agent);
    expect(fetchInit.dispatcher).not.toBeInstanceOf(ProxyAgent);
    expect(axiosConfig.proxy).toBe(false);
    expect(axiosConfig.httpAgent?.constructor?.name).toBe("Agent");
    expect(axiosConfig.httpsAgent?.constructor?.name).toBe("Agent");
    expect(typeof axiosConfig.adapter).toBe("function");
  });

  it("fails closed when a proxy provider has no usable proxy", () => {
    expect(() => createProviderEgressDecision(
      { id: "apimart", egressMode: "proxy" },
      { status: "missing", source: "none" },
    )).toThrowError(expect.objectContaining({ kind: "missing-proxy" }));

    expect(() => createProviderEgressDecision(
      { id: "google-ai-studio", egressMode: "proxy" },
      { status: "invalid", source: "none" },
    )).toThrowError(expect.objectContaining({ kind: "invalid-proxy" }));
  });

  it("blocks providers whose persisted egress mode was invalid", () => {
    expect(() => createProviderEgressDecision({
      id: "custom-bad",
      egressMode: "direct",
      configurationError: "invalid-egress",
    }, readyProxy)).toThrowError(expect.objectContaining({ kind: "invalid-egress" }));
  });

  it("uses an Undici ProxyAgent for fetch without exposing credentials in the cache key", () => {
    const decision = createProviderEgressDecision({ id: "apimart", egressMode: "proxy" }, readyProxy);
    const init = buildFetchRequestInit(decision, { method: "POST", body: "{}" });

    expect(init.dispatcher).toBeInstanceOf(ProxyAgent);
    expect(decision.cacheKey).toBe("proxy-fingerprint");
    expect(JSON.stringify(decision)).not.toContain("user:pass");
  });

  it("starts TCP keepalive before long synchronous provider responses can lose the proxy tunnel", () => {
    const decision = createProviderEgressDecision({ id: "easyrouter", egressMode: "proxy" }, readyProxy);
    if (decision.mode !== "proxy") throw new Error("expected proxy decision");

    expect(buildProxyAgentOptions(decision)).toMatchObject({
      uri: "http://127.0.0.1:7890",
      token: "Basic dXNlcjpwYXNz",
      requestTls: { keepAlive: true, keepAliveInitialDelay: 10_000 },
      proxyTls: { keepAlive: true, keepAliveInitialDelay: 10_000 },
    });
  });

  it("uses CONNECT-capable HTTPS proxy agents for Axios and cannot be overridden by the caller", () => {
    const decision = createProviderEgressDecision({ id: "google-ai-studio", egressMode: "proxy" }, readyProxy);
    const bypassAdapter = vi.fn();
    const bypassRedirect = vi.fn();
    const bypassLookup = vi.fn();
    const config = buildAxiosRequestConfig(decision, {
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      proxy: { host: "bypass.invalid", port: 1 },
      httpAgent: "bypass-http" as any,
      httpsAgent: "bypass-https" as any,
      adapter: bypassAdapter as any,
      transport: {} as any,
      socketPath: "\\\\.\\pipe\\bypass",
      beforeRedirect: bypassRedirect,
      lookup: bypassLookup,
      httpVersion: 2,
      maxRedirects: 99,
    } as any);

    expect(config.proxy).toBe(false);
    expect(config.httpsAgent?.constructor?.name).toBe("HttpsProxyAgent");
    expect(config.httpAgent?.constructor?.name).toBe("HttpProxyAgent");
    expect(typeof config.adapter).toBe("function");
    expect(config.adapter).not.toBe(bypassAdapter);
    expect(config.transport).toBeUndefined();
    expect(config.socketPath).toBeUndefined();
    expect(typeof config.beforeRedirect).toBe("function");
    expect(config.beforeRedirect).not.toBe(bypassRedirect);
    expect((config as any).lookup).toBeUndefined();
    expect(config.httpVersion).toBe(1);
    expect(config.maxRedirects).toBe(99);
  });

  it("preserves the caller's redirect semantics while keeping redirect hops on the provider agents", () => {
    const decision = createProviderEgressDecision({ id: "apimart", egressMode: "proxy" }, readyProxy);
    const config = buildAxiosRequestConfig(decision, {
      url: "https://cdn.example.test/result.png",
    }, { purpose: "media" });
    const fetchInit = buildFetchRequestInit(decision, {});

    expect(config.maxRedirects).toBeUndefined();
    expect(config.httpAgent?.constructor?.name).toBe("HttpProxyAgent");
    expect(config.httpsAgent?.constructor?.name).toBe("HttpsProxyAgent");
    expect(fetchInit.redirect).toBeUndefined();
  });

  it("classifies network errors without embedding provider or proxy URLs", () => {
    const error = new ProviderNetworkError("proxy-connect", "代理连接失败");
    expect(error.kind).toBe("proxy-connect");
    expect(JSON.stringify(error)).not.toContain("127.0.0.1");
  });
});
