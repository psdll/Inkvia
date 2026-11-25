import http, { type RequestListener, type Server } from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { inspect } from "node:util";
import axios from "axios";
import { HttpProxyAgent } from "http-proxy-agent";
import { ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixtureOrigins = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/runtime-isolation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/runtime-isolation")>("@/lib/runtime-isolation");
  return { ...actual, assertNetworkTarget: (target: string | URL) => actual.assertNetworkTarget(target, { profile: "test", networkMode: "explicit-test", allowedTestOrigins: [...fixtureOrigins] } as any) };
});

import {
  axiosWithProviderEgress,
  buildAxiosRequestConfig,
  createProviderEgressDecision,
  directAxios,
  fetchWithProviderEgress,
  type ProviderEgressDecision,
} from "@/lib/providers/transport";

type ProxyHarness = {
  server: Server;
  url: string;
  fingerprint: string;
  hits: number;
  authorizedHits: number;
};

const servers = new Set<Server>();
const serverSockets = new Map<Server, Set<net.Socket>>();
const tlsPfx = Buffer.from(
  readFileSync(
    resolve(process.cwd(), "__tests__/fixtures/provider-transport.pfx.b64"),
    "utf8",
  ).trim(),
  "base64",
);
const tlsOptions = { pfx: tlsPfx, passphrase: "test-only" };
const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const originalAxiosDefaults = {
  adapter: axios.defaults.adapter,
  httpAgent: axios.defaults.httpAgent,
  httpsAgent: axios.defaults.httpsAgent,
  transport: axios.defaults.transport,
  socketPath: axios.defaults.socketPath,
};
let proxySequence = 0;

async function listen(server: Server): Promise<number> {
  servers.add(server);
  const sockets = new Set<net.Socket>();
  serverSockets.set(server, sockets);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  fixtureOrigins.add(`http://127.0.0.1:${port}`);
  fixtureOrigins.add(`https://127.0.0.1:${port}`);
  return port;
}

async function closeServer(server: Server) {
  servers.delete(server);
  for (const socket of serverSockets.get(server) || []) socket.destroy();
  serverSockets.delete(server);
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => closeServer(server)));
  fixtureOrigins.clear();
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  if (originalTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsSetting;
  Object.assign(axios.defaults, originalAxiosDefaults);
});

async function createOrigin(handler?: RequestListener) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (handler) return handler(req, res);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const port = await listen(server);
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    get hits() { return hits; },
  };
}

async function createHttpsOrigin(handler?: RequestListener) {
  let hits = 0;
  const server = https.createServer(tlsOptions, (req, res) => {
    hits += 1;
    if (handler) return handler(req, res);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const port = await listen(server);
  return {
    server,
    url: `https://127.0.0.1:${port}`,
    get hits() { return hits; },
  };
}

async function createProxy(
  requiredAuthorization?: string,
  secure = false,
  rejection?: { body?: string; headers?: Record<string, string> },
): Promise<ProxyHarness> {
  const harness = { hits: 0, authorizedHits: 0 };
  const isAuthorized = (header: string | string[] | undefined) => {
    const value = Array.isArray(header) ? header[0] : header;
    if (!requiredAuthorization || value === requiredAuthorization) {
      harness.authorizedHits += 1;
      return true;
    }
    return false;
  };
  const listener: RequestListener = (req, res) => {
    harness.hits += 1;
    if (!isAuthorized(req.headers["proxy-authorization"])) {
      res.writeHead(407, {
        "Proxy-Authenticate": "Basic realm=test",
        ...(rejection?.headers || {}),
      });
      res.end(rejection?.body || "proxy auth required");
      return;
    }
    let target: URL;
    try {
      target = new URL(req.url || "");
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    const upstream = http.request(target, { method: req.method, headers }, (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  };
  const server = secure
    ? https.createServer(tlsOptions, listener)
    : http.createServer(listener);
  server.on("connect", (req, clientSocket, head) => {
    harness.hits += 1;
    if (!isAuthorized(req.headers["proxy-authorization"])) {
      clientSocket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=test\r\n\r\n");
      return;
    }
    const authority = String(req.url || "");
    const separator = authority.lastIndexOf(":");
    const host = authority.slice(0, separator);
    const port = Number(authority.slice(separator + 1));
    const upstream = net.connect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
  });
  const port = await listen(server);
  proxySequence += 1;
  return Object.assign(harness, {
    server,
    url: `${secure ? "https" : "http"}://127.0.0.1:${port}`,
    fingerprint: `proxy-${proxySequence}`,
  });
}

async function createHangingProxy(): Promise<ProxyHarness> {
  const harness = { hits: 0, authorizedHits: 0 };
  const server = http.createServer(() => {
    harness.hits += 1;
    // Deliberately never send proxy response headers.
  });
  server.on("connect", () => {
    harness.hits += 1;
    // Deliberately leave the tunnel negotiation pending.
  });
  const port = await listen(server);
  proxySequence += 1;
  return Object.assign(harness, {
    server,
    url: `http://127.0.0.1:${port}`,
    fingerprint: `proxy-${proxySequence}`,
  });
}

function direct(providerId = "kie"): ProviderEgressDecision {
  return createProviderEgressDecision({ id: providerId, egressMode: "direct" });
}

function proxied(proxy: ProxyHarness, token?: string): ProviderEgressDecision {
  return createProviderEgressDecision(
    { id: "apimart", egressMode: "proxy" },
    {
      status: "ready",
      source: "database",
      uri: proxy.url,
      token,
      fingerprint: proxy.fingerprint,
    },
  );
}

describe("provider transport integration", () => {
  it("forces IPv4 only for direct KIE Axios requests", () => {
    const kieConfig = buildAxiosRequestConfig(direct("kie"), {
      url: "https://api.kie.ai/api/v1/jobs/recordInfo",
    });
    const volcengineConfig = buildAxiosRequestConfig(direct("volcengine"), {
      url: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/test",
    });

    expect((kieConfig.httpsAgent as https.Agent).options.family).toBe(4);
    expect((volcengineConfig.httpsAgent as https.Agent).options.family).toBeUndefined();
  });

  it("normalizes a read-only Fetch timeout error without throwing a second TypeError", async () => {
    const origin = await createOrigin(() => {
      // Keep the response pending until AbortSignal.timeout aborts the request.
    });

    const error = await fetchWithProviderEgress(direct("jiekou"), origin.url, {
      signal: AbortSignal.timeout(25),
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Provider request timed out");
  });

  it("keeps direct Fetch and Axios off a trap HTTP_PROXY", async () => {
    const origin = await createOrigin();
    const trap = await createProxy();
    process.env.HTTP_PROXY = trap.url;
    process.env.HTTPS_PROXY = trap.url;
    const previousDispatcher = getGlobalDispatcher();
    const trapDispatcher = new ProxyAgent(trap.url);
    setGlobalDispatcher(trapDispatcher);

    try {
      const fetchResponse = await fetchWithProviderEgress(direct(), `${origin.url}/fetch`);
      const axiosResponse = await axiosWithProviderEgress(direct(), { url: `${origin.url}/axios` });

      expect(fetchResponse.status).toBe(200);
      expect(axiosResponse.status).toBe(200);
      expect(origin.hits).toBe(2);
      expect(trap.hits).toBe(0);
    } finally {
      setGlobalDispatcher(previousDispatcher);
      await trapDispatcher.close();
    }
  });

  it("does not inherit Axios defaults that were polluted before the transport module loaded", async () => {
    let receivedBody = "";
    let receivedUrl = "";
    let receivedAuthorization: string | undefined;
    let receivedPoisonHeader: string | undefined;
    const origin = await createOrigin((req, res) => {
      receivedUrl = String(req.url || "");
      receivedAuthorization = req.headers.authorization;
      receivedPoisonHeader = req.headers["x-poison-transform"] as string | undefined;
      req.setEncoding("utf8");
      req.on("data", (chunk) => { receivedBody += chunk; });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    vi.resetModules();
    const freshAxios = (await import("axios")).default;
    freshAxios.defaults.baseURL = "http://poison-base.invalid";
    (freshAxios.defaults as any).params = { leaked: "global-param" };
    (freshAxios.defaults as any).auth = { username: "global", password: "secret" };
    freshAxios.defaults.headers.common.Authorization = "Bearer global-default-secret";
    freshAxios.defaults.transformRequest = [(_data, headers) => {
      headers.set("x-poison-transform", "yes");
      return JSON.stringify({ poisoned: true });
    }];
    freshAxios.defaults.transformResponse = [() => ({ poisoned: true })];
    freshAxios.defaults.validateStatus = () => false;
    freshAxios.defaults.adapter = async () => { throw new Error("poison adapter used"); };

    try {
      const freshTransport = await import("@/lib/providers/transport");
      const response = await freshTransport.directAxios({
        url: `${origin.url}/isolated`,
        method: "POST",
        data: { safe: true },
      });

      expect(response.data).toEqual({ ok: true });
      expect(receivedUrl).toBe("/isolated");
      expect(receivedAuthorization).toBeUndefined();
      expect(receivedPoisonHeader).toBeUndefined();
      expect(receivedBody).toBe(JSON.stringify({ safe: true }));
    } finally {
      vi.resetModules();
    }
  });

  it("isolates direct and proxied Axios requests from global Axios defaults", async () => {
    const origin = await createOrigin();
    const trap = await createProxy();
    const requiredProxy = await createProxy();
    const poisonAdapter = vi.fn(async (config) => ({
      data: { poisoned: true },
      status: 299,
      statusText: "poisoned",
      headers: {},
      config,
    }));
    const poisonTransport = {
      request: vi.fn(() => {
        throw new Error("global transport must not run");
      }),
    };
    axios.defaults.adapter = poisonAdapter as any;
    axios.defaults.httpAgent = new HttpProxyAgent(trap.url);
    axios.defaults.httpsAgent = new HttpProxyAgent(trap.url);
    axios.defaults.transport = poisonTransport as any;
    axios.defaults.socketPath = "\\\\.\\pipe\\provider-egress-trap";

    const directResponse = await axiosWithProviderEgress(direct(), { url: `${origin.url}/direct` });
    const genericDirectResponse = await directAxios({ url: `${origin.url}/generic-direct` });
    const proxyResponse = await axiosWithProviderEgress(proxied(requiredProxy), {
      url: `${origin.url}/proxy`,
    });

    expect(directResponse.status).toBe(200);
    expect(genericDirectResponse.status).toBe(200);
    expect(proxyResponse.status).toBe(200);
    expect(origin.hits).toBe(3);
    expect(trap.hits).toBe(0);
    expect(requiredProxy.hits).toBeGreaterThan(0);
    expect(poisonAdapter).not.toHaveBeenCalled();
    expect(poisonTransport.request).not.toHaveBeenCalled();
  });

  it("sends Fetch and Axios through the authenticated proxy", async () => {
    const origin = await createOrigin();
    const token = `Basic ${Buffer.from("user:pass").toString("base64")}`;
    const proxy = await createProxy(token);
    const decision = proxied(proxy, token);

    const fetchResponse = await fetchWithProviderEgress(decision, `${origin.url}/fetch`);
    const axiosResponse = await axiosWithProviderEgress(decision, { url: `${origin.url}/axios` });

    expect(await fetchResponse.json()).toEqual({ ok: true });
    expect(axiosResponse.status).toBe(200);
    expect(origin.hits).toBe(2);
    expect(proxy.hits).toBeGreaterThanOrEqual(2);
    expect(proxy.authorizedHits).toBe(proxy.hits);
  });

  it("uses CONNECT for an HTTPS target through an HTTP proxy", async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const origin = await createHttpsOrigin();
    const proxy = await createProxy();
    const decision = proxied(proxy);

    const fetchResponse = await fetchWithProviderEgress(decision, `${origin.url}/fetch`);
    const axiosResponse = await axiosWithProviderEgress(decision, { url: `${origin.url}/axios` });

    expect(await fetchResponse.json()).toEqual({ ok: true });
    expect(axiosResponse.status).toBe(200);
    expect(origin.hits).toBe(2);
    expect(proxy.hits).toBeGreaterThanOrEqual(2);
  });

  it("supports an HTTPS proxy for both Fetch and Axios", async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const origin = await createOrigin();
    const proxy = await createProxy(undefined, true);
    const decision = proxied(proxy);

    const fetchResponse = await fetchWithProviderEgress(decision, `${origin.url}/fetch`);
    const axiosResponse = await axiosWithProviderEgress(decision, { url: `${origin.url}/axios` });

    expect(fetchResponse.status).toBe(200);
    expect(axiosResponse.status).toBe(200);
    expect(origin.hits).toBe(2);
    expect(proxy.hits).toBeGreaterThanOrEqual(2);
  });

  it("keeps Axios redirect hops on the selected proxy and ignores caller redirect hooks", async () => {
    let origin!: Awaited<ReturnType<typeof createOrigin>>;
    origin = await createOrigin((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { Location: `${origin.url}/final` });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ redirected: true }));
    });
    const proxy = await createProxy();
    const bypassHook = vi.fn();

    const response = await axiosWithProviderEgress(proxied(proxy), {
      url: `${origin.url}/start`,
      beforeRedirect: bypassHook,
    });

    expect(response.data).toEqual({ redirected: true });
    expect(bypassHook).not.toHaveBeenCalled();
    expect(origin.hits).toBe(2);
    expect(proxy.hits).toBeGreaterThanOrEqual(2);
  });

  it("blocks cross-origin API redirects before either Fetch or Axios can send secrets", async () => {
    const redirected = await createOrigin();
    const source = await createOrigin((_req, res) => {
      res.writeHead(302, { Location: `${redirected.url}/collect` });
      res.end();
    });
    const proxy = await createProxy();
    const decision = proxied(proxy);

    await expect(fetchWithProviderEgress(decision, `${source.url}/fetch`, {
      headers: { Authorization: "Bearer fetch-secret", "x-api-key": "fetch-api-secret" },
    })).rejects.toMatchObject({ kind: "invalid-target" });
    await expect(axiosWithProviderEgress(decision, {
      url: `${source.url}/axios`,
      headers: { Authorization: "Bearer axios-secret", "x-api-key": "axios-api-secret" },
    })).rejects.toThrow();

    expect(source.hits).toBe(2);
    expect(redirected.hits).toBe(0);
    expect(proxy.hits).toBeGreaterThanOrEqual(2);
  });

  it("keeps cross-origin media redirects on the selected proxy and strips credentials", async () => {
    const received: Array<Record<string, string | string[] | undefined>> = [];
    const redirected = await createOrigin((req, res) => {
      received.push(req.headers);
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end("media");
    });
    const source = await createOrigin((_req, res) => {
      res.writeHead(302, { Location: `${redirected.url}/asset` });
      res.end();
    });
    const proxy = await createProxy();
    const response = await axiosWithProviderEgress(proxied(proxy), {
      url: `${source.url}/start`,
      headers: {
        Authorization: "Bearer must-not-cross",
        "x-api-key": "must-not-cross-either",
        Cookie: "session=must-not-cross",
        "x-safe-header": "preserved",
      },
    }, { purpose: "media" });

    expect(response.data).toBe("media");
    expect(source.hits).toBe(1);
    expect(redirected.hits).toBe(1);
    expect(proxy.hits).toBeGreaterThanOrEqual(2);
    expect(received[0]?.authorization).toBeUndefined();
    expect(received[0]?.["x-api-key"]).toBeUndefined();
    expect(received[0]?.cookie).toBeUndefined();
    expect(received[0]?.["x-safe-header"]).toBe("preserved");
  });

  it("fails closed on a TLS validation error without issuing an HTTP request to the origin", async () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const origin = await createHttpsOrigin();
    const proxy = await createProxy();
    const decision = proxied(proxy);

    const fetchError = await fetchWithProviderEgress(decision, origin.url).catch((error) => error);
    expect(fetchError).toBeInstanceOf(Error);
    expect(String(fetchError.code || "")).toMatch(/CERT|SELF_SIGNED|VERIFY/i);
    await expect(axiosWithProviderEgress(decision, { url: origin.url, timeout: 500 })).rejects.toThrow();

    expect(proxy.hits).toBeGreaterThanOrEqual(2);
    expect(origin.hits).toBe(0);
  });

  it("fails closed on proxy 407 without touching the origin", async () => {
    const origin = await createOrigin();
    const required = `Basic ${Buffer.from("right:secret").toString("base64")}`;
    const reflectedSecret = "reflected-provider-secret";
    const reflectedUrl = `${origin.url}/private/provider/path`;
    const proxy = await createProxy(required, false, {
      body: JSON.stringify({ error: { code: "proxy_auth", message: `${reflectedSecret} ${reflectedUrl}` } }),
      headers: { "x-reflected-target": reflectedUrl, "x-reflected-secret": reflectedSecret },
    });
    const wrongToken = `Basic ${Buffer.from("wrong:secret").toString("base64")}`;
    const bearerSecret = reflectedSecret;
    const querySecret = "provider-query-secret";
    const bodySecret = "provider-body-secret";
    const decision = proxied(proxy, wrongToken);

    const fetchError = await fetchWithProviderEgress(
      decision,
      `${origin.url}/private/fetch/path?key=${encodeURIComponent(querySecret)}`,
    ).catch((error) => error);
    const axiosError = await axiosWithProviderEgress(decision, {
      url: `${origin.url}/private/provider/path`,
      method: "POST",
      timeout: 500,
      headers: {
        Authorization: `Bearer ${bearerSecret}`,
        "x-api-key": bearerSecret,
      },
      params: { key: querySecret },
      data: { apiKey: bodySecret },
    }).catch((error) => error);

    expect(fetchError).toBeInstanceOf(Error);
    expect(fetchError).toMatchObject({ kind: "proxy-connect", message: "Proxy authentication failed (407)" });
    expect(axios.isAxiosError(axiosError)).toBe(true);
    expect(axiosError.response?.status).toBe(407);
    expect(axiosError.response?.data).toMatchObject({ error: { code: "proxy_auth" } });
    for (const error of [fetchError, axiosError]) {
      const inspected = inspect(error, { depth: 12, showHidden: true });
      const serialized = JSON.stringify(error);
      for (const secret of [wrongToken, bearerSecret, querySecret, bodySecret]) {
        expect(inspected).not.toContain(secret);
        expect(serialized).not.toContain(secret);
      }
      expect(serialized).not.toContain("Proxy-Authorization");
      expect(inspected).not.toContain("/private/provider/path");
      expect(serialized).not.toContain("/private/provider/path");
      expect(inspected).not.toContain("/private/fetch/path");
      expect(serialized).not.toContain("/private/fetch/path");
    }

    expect(proxy.hits).toBeGreaterThanOrEqual(2);
    expect(proxy.authorizedHits).toBe(0);
    expect(origin.hits).toBe(0);
  });

  it("fails closed when the proxy port refuses connections", async () => {
    const origin = await createOrigin();
    const stoppedProxy = await createProxy();
    await closeServer(stoppedProxy.server);
    const decision = proxied(stoppedProxy);

    await expect(fetchWithProviderEgress(decision, origin.url, {
      signal: AbortSignal.timeout(500),
    })).rejects.toThrow();
    await expect(axiosWithProviderEgress(decision, {
      url: origin.url,
      timeout: 500,
    })).rejects.toThrow();

    expect(origin.hits).toBe(0);
  });

  it("fails closed when proxy negotiation times out", async () => {
    const origin = await createOrigin();
    const proxy = await createHangingProxy();
    const decision = proxied(proxy);

    await expect(fetchWithProviderEgress(decision, origin.url, {
      signal: AbortSignal.timeout(100),
    })).rejects.toThrow();
    await expect(axiosWithProviderEgress(decision, {
      url: origin.url,
      timeout: 100,
    })).rejects.toThrow();

    expect(proxy.hits).toBeGreaterThanOrEqual(2);
    expect(origin.hits).toBe(0);
  });

  it("switches proxy A to B for the next request without interrupting A's in-flight body", async () => {
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const origin = await createOrigin(async (req, res) => {
      if (req.url === "/slow") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.flushHeaders();
        await slowGate;
        res.end("slow-complete");
        return;
      }
      res.end("fast-complete");
    });
    const proxyA = await createProxy();
    const proxyB = await createProxy();

    const inFlight = await fetchWithProviderEgress(proxied(proxyA), `${origin.url}/slow`);
    const next = await fetchWithProviderEgress(proxied(proxyB), `${origin.url}/fast`);
    expect(await next.text()).toBe("fast-complete");
    expect(proxyA.hits).toBeGreaterThan(0);
    expect(proxyB.hits).toBeGreaterThan(0);

    releaseSlow();
    expect(await inFlight.text()).toBe("slow-complete");
  });
});
