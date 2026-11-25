import { isDesktopMode } from "@/lib/desktop-mode";
import { assertNetworkTarget } from "@/lib/runtime-isolation";
import "server-only";
import { startDebugHttp } from "@/lib/creative-agent/debug-http";

import { Agent as NodeHttpAgent } from "node:http";
import { Agent as NodeHttpsAgent } from "node:https";
import { Prisma } from "@prisma/client";
import axios, {
  AxiosHeaders,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import {
  Agent,
  Headers,
  ProxyAgent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from "undici";
import prisma from "@/lib/prisma";
import {
  readProxySettingRaw,
  resolveProviderProxyFromRaw,
  type ResolvedProxy,
} from "@/lib/providers/proxy-config";
import { getRegisteredProviders, toResolvedProvider } from "@/lib/providers/registry";
import type { ProviderEgressMode, ResolvedProvider } from "@/lib/providers/types";

export type ProviderNetworkErrorKind =
  | "provider-not-found"
  | "invalid-egress"
  | "missing-proxy"
  | "invalid-proxy"
  | "invalid-target"
  | "proxy-connect";

export class ProviderNetworkError extends Error {
  constructor(public readonly kind: ProviderNetworkErrorKind, message: string) {
    super(message);
    this.name = "ProviderNetworkError";
  }
}

type ProviderEgressInput = {
  id: string;
  egressMode: ProviderEgressMode;
  configurationError?: "invalid-egress";
  baseUrl?: string;
};

export type ProviderEgressDecision =
  | { providerId: string; mode: "direct"; cacheKey: "direct" }
  | {
      providerId: string;
      mode: "proxy";
      cacheKey: string;
      agentSlot: string;
      proxyUri: string;
      proxyToken?: string;
    };

export type ProviderRequestContext = Readonly<{
  provider: Readonly<ResolvedProvider>;
  decision: Readonly<ProviderEgressDecision>;
}>;

type ProviderTransportOptions = { purpose?: "api" | "media" };

export function createProviderEgressDecision(
  provider: ProviderEgressInput,
  proxy?: ResolvedProxy,
): ProviderEgressDecision {
  if (provider.configurationError === "invalid-egress") {
    throw new ProviderNetworkError("invalid-egress", "平台出口配置无效，请管理员检查配置");
  }
  if (provider.egressMode === "direct" || proxy?.direct || isDesktopLoopback(provider.baseUrl)) {
    return { providerId: provider.id, mode: "direct", cacheKey: "direct" };
  }
  if (!proxy || proxy.status === "missing") {
    throw new ProviderNetworkError("missing-proxy", "该平台需要代理，但管理员尚未配置可用代理");
  }
  if (proxy.status === "invalid" || !proxy.uri || !proxy.fingerprint) {
    throw new ProviderNetworkError("invalid-proxy", "代理配置无效，请管理员检查配置");
  }
  return {
    providerId: provider.id,
    mode: "proxy",
    cacheKey: proxy.fingerprint,
    agentSlot: proxy.source === "database" ? "database" : `environment:${provider.id}`,
    proxyUri: proxy.uri,
    proxyToken: proxy.token,
  };
}

function isDesktopLoopback(target?: string | URL): boolean {
  if (!isDesktopMode() || !target) return false;
  try {
    const host = new URL(target).hostname.replace(/\.$/, "");
    return host === "localhost" || host === "[::1]" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host);
  } catch { return false; }
}

export async function resolveProviderEgress(providerId: string): Promise<ProviderEgressDecision> {
  return (await resolveProviderRequestContext(providerId)).decision;
}

export async function resolveProviderRequestContext(providerId: string): Promise<ProviderRequestContext> {
  return prisma.$transaction(async (client) => {
    const configured = (await getRegisteredProviders(client)).find((item) => item.id === providerId);
    if (!configured || configured.enabled === false) {
      throw new ProviderNetworkError("provider-not-found", "平台未配置或已停用");
    }
    const provider = toResolvedProvider(configured);
    const rawProxy = provider.egressMode === "proxy" ? await readProxySettingRaw(client) : null;
    const proxy = provider.egressMode === "proxy"
      ? resolveProviderProxyFromRaw(provider.id, rawProxy)
      : undefined;
    const decision = createProviderEgressDecision(provider, proxy);
    return Object.freeze({
      provider: Object.freeze(provider),
      decision: Object.freeze(decision),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

const directAgent = new Agent();
const directHttpAgent = new NodeHttpAgent();
const directHttpsAgent = new NodeHttpsAgent();
const kieDirectHttpsAgent = new NodeHttpsAgent({ family: 4 });
const nodeAxiosAdapter = axios.getAdapter("http");

function safeAxiosTransformRequest(this: AxiosRequestConfig, data: unknown, headers: AxiosHeaders) {
  if (data === undefined || data === null || typeof data === "string") return data;
  if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer;
  if (typeof URLSearchParams !== "undefined" && data instanceof URLSearchParams) {
    headers.setContentType("application/x-www-form-urlencoded;charset=utf-8", false);
    return data.toString();
  }
  if (
    (typeof FormData !== "undefined" && data instanceof FormData)
    || (typeof Blob !== "undefined" && data instanceof Blob)
    || (typeof (data as { pipe?: unknown }).pipe === "function")
    || (typeof (data as { getHeaders?: unknown }).getHeaders === "function")
  ) return data;
  if (typeof data === "object" || headers.getContentType()?.includes("application/json")) {
    headers.setContentType("application/json", false);
    return JSON.stringify(data);
  }
  return data;
}

function safeAxiosTransformResponse(this: AxiosRequestConfig, data: unknown) {
  if (typeof data !== "string" || (!data && this.responseType !== "json")) return data;
  if (this.responseType && this.responseType !== "json") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

const isolatedAxios = axios.create();
for (const key of Object.keys(isolatedAxios.defaults)) {
  delete (isolatedAxios.defaults as Record<string, unknown>)[key];
}
Object.assign(isolatedAxios.defaults, {
  adapter: nodeAxiosAdapter,
  proxy: false,
  httpAgent: directHttpAgent,
  httpsAgent: directHttpsAgent,
  transport: undefined,
  socketPath: undefined,
  beforeRedirect: undefined,
  httpVersion: 1,
  timeout: 0,
  maxContentLength: -1,
  maxBodyLength: -1,
  transitional: {
    silentJSONParsing: true,
    forcedJSONParsing: true,
    clarifyTimeoutError: false,
  },
  transformRequest: [safeAxiosTransformRequest],
  transformResponse: [safeAxiosTransformResponse],
  validateStatus: (status: number) => status >= 200 && status < 300,
  headers: {
    common: { Accept: "application/json, text/plain, */*" },
    delete: {},
    get: {},
    head: {},
    post: {},
    put: {},
    patch: {},
  },
});
const proxyAgents = new Map<string, ProxyAgent>();
const activeProxyBySlot = new Map<string, string>();
const MAX_PROXY_AGENTS = 4;
const PROXY_KEEPALIVE_INITIAL_DELAY_MS = 10_000;

export function buildProxyAgentOptions(
  decision: Extract<ProviderEgressDecision, { mode: "proxy" }>,
): ProxyAgent.Options {
  const keepAlive = {
    keepAlive: true,
    keepAliveInitialDelay: PROXY_KEEPALIVE_INITIAL_DELAY_MS,
  };
  return {
    uri: decision.proxyUri,
    ...(decision.proxyToken ? { token: decision.proxyToken } : {}),
    requestTls: keepAlive,
    proxyTls: keepAlive,
  };
}

function retireProxyAgent(cacheKey: string) {
  const retired = proxyAgents.get(cacheKey);
  proxyAgents.delete(cacheKey);
  for (const [slot, activeKey] of activeProxyBySlot) {
    if (activeKey === cacheKey) activeProxyBySlot.delete(slot);
  }
  if (retired) void retired.close().catch(() => undefined);
}

function proxyDispatcher(decision: Extract<ProviderEgressDecision, { mode: "proxy" }>): ProxyAgent {
  const previousKey = activeProxyBySlot.get(decision.agentSlot);
  activeProxyBySlot.set(decision.agentSlot, decision.cacheKey);
  if (
    previousKey
    && previousKey !== decision.cacheKey
    && ![...activeProxyBySlot.values()].includes(previousKey)
  ) {
    retireProxyAgent(previousKey);
  }
  const existing = proxyAgents.get(decision.cacheKey);
  if (existing) {
    proxyAgents.delete(decision.cacheKey);
    proxyAgents.set(decision.cacheKey, existing);
    return existing;
  }
  const created = new ProxyAgent(buildProxyAgentOptions(decision));
  proxyAgents.set(decision.cacheKey, created);
  if (proxyAgents.size > MAX_PROXY_AGENTS) {
    const oldestKey = proxyAgents.keys().next().value as string | undefined;
    if (oldestKey) {
      const oldest = proxyAgents.get(oldestKey);
      proxyAgents.delete(oldestKey);
      for (const [slot, activeKey] of activeProxyBySlot) {
        if (activeKey === oldestKey) activeProxyBySlot.delete(slot);
      }
      if (oldest) void oldest.close().catch(() => undefined);
    }
  }
  return created;
}

export function buildFetchRequestInit(
  decision: ProviderEgressDecision,
  init: UndiciRequestInit = {},
): UndiciRequestInit & { dispatcher: Agent | ProxyAgent } {
  return {
    ...init,
    dispatcher: decision.mode === "direct" ? directAgent : proxyDispatcher(decision),
  };
}

type NetworkFailureSignals = {
  code?: string;
  proxyAuthRequired: boolean;
};

function inspectNetworkFailure(error: unknown): NetworkFailureSignals {
  let current = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  let code = "";
  let proxyAuthRequired = false;
  const seen = new Set<unknown>();
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth += 1) {
    seen.add(current);
    const candidateCode = typeof current.code === "string" ? current.code : "";
    if (!code && candidateCode) code = candidateCode;
    const message = typeof current.message === "string" ? current.message : "";
    if (/proxy[^\n\r]*\b407\b|\b407\b[^\n\r]*proxy/i.test(message)) proxyAuthRequired = true;
    current = current.cause && typeof current.cause === "object"
      ? current.cause as typeof current
      : null;
  }
  return { code: code || undefined, proxyAuthRequired };
}

function sanitizeProviderFetchError(error: unknown, signals = inspectNetworkFailure(error)): Error {
  if (error instanceof ProviderNetworkError) return error;
  const source = error instanceof Error ? error : null;
  const timedOut = source?.name === "AbortError" || source?.name === "TimeoutError";
  const message = timedOut
    ? "Provider request timed out"
    : signals.code
      ? `Provider request failed (${signals.code})`
      : "Provider request failed";
  const sanitized = new Error(message) as Error & { code?: string };
  sanitized.name = source?.name || "Error";
  if (signals.code) sanitized.code = signals.code;
  return sanitized;
}

async function dispatchProviderFetch(
  decision: ProviderEgressDecision,
  url: string | URL,
  init: UndiciRequestInit,
): Promise<Response> {
  if (decision.mode === "proxy" && isDesktopLoopback(url)) {
    decision = { providerId: decision.providerId, mode: "direct", cacheKey: "direct" };
  }
  let debug: ReturnType<typeof startDebugHttp> = null;
  try {
    assertNetworkTarget(url);
    if (decision.mode === "proxy") assertNetworkTarget(decision.proxyUri);
    const request = buildFetchRequestInit(decision, init);
    debug = startDebugHttp({ url: String(url), method: request.method, headers: request.headers, body: request.body, providerId: decision.providerId, mode: decision.mode });
    const response = await undiciFetch(url, request) as unknown as Response;
    debug?.response(response.status, Object.fromEntries(response.headers.entries()));
    void debug?.readJson(response);
    return response;
  } catch (error) {
    debug?.error(error);
    const signals = inspectNetworkFailure(error);
    if (decision.mode === "proxy" && signals.proxyAuthRequired) {
      throw new ProviderNetworkError("proxy-connect", "Proxy authentication failed (407)");
    }
    throw sanitizeProviderFetchError(error, signals);
  }
}

export async function fetchWithProviderEgress(
  decision: ProviderEgressDecision,
  url: string | URL,
  init: UndiciRequestInit = {},
  options: ProviderTransportOptions = {},
): Promise<Response> {
  if (init.redirect === "manual" || init.redirect === "error") {
    return dispatchProviderFetch(decision, url, init);
  }

  let currentUrl: URL;
  try {
    currentUrl = new URL(url);
  } catch {
    throw new ProviderNetworkError("invalid-target", "上游请求地址无效");
  }
  const initialOrigin = currentUrl.origin;
  let method = String(init.method || "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);

  for (let redirectCount = 0; redirectCount <= 20; redirectCount += 1) {
    const response = await dispatchProviderFetch(decision, currentUrl, {
      ...init,
      method,
      body,
      headers,
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (redirectCount === 20) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderNetworkError("invalid-target", "上游重定向次数过多");
    }

    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.username || nextUrl.password) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderNetworkError("invalid-target", "上游重定向地址不能包含凭据");
    }
    const crossedOrigin = nextUrl.origin !== initialOrigin;
    if (crossedOrigin && options.purpose !== "media") {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderNetworkError("invalid-target", "上游 API 拒绝跨域重定向");
    }
    if (crossedOrigin) {
      if (method !== "GET" && method !== "HEAD") {
        await response.body?.cancel().catch(() => undefined);
        throw new ProviderNetworkError("invalid-target", "媒体请求拒绝携带请求体的跨域重定向");
      }
      stripSensitiveHeaders(headers);
    }

    if ((response.status === 301 || response.status === 302) && method === "POST"
      || response.status === 303 && method !== "HEAD") {
      method = "GET";
      body = undefined;
      for (const name of ["content-encoding", "content-language", "content-location", "content-type", "content-length"]) {
        headers.delete(name);
      }
    }
    await response.body?.cancel().catch(() => undefined);
    currentUrl = nextUrl;
  }
  throw new ProviderNetworkError("invalid-target", "上游重定向失败");
}

export async function providerFetch(
  providerId: string,
  url: string | URL,
  init: UndiciRequestInit = {},
  options: ProviderTransportOptions = {},
): Promise<Response> {
  return fetchWithProviderEgress(await resolveProviderEgress(providerId), url, init, options);
}

function isSensitiveHeader(name: string): boolean {
  return /authorization|api[-_]?key|token|secret|cookie/i.test(name);
}

function stripSensitiveHeaders(headers: Headers | Record<string, unknown>): void {
  if (headers instanceof Headers) {
    for (const name of [...headers.keys()]) {
      if (isSensitiveHeader(name)) headers.delete(name);
    }
    return;
  }
  for (const name of Object.keys(headers || {})) {
    if (isSensitiveHeader(name)) delete headers[name];
  }
}

function absoluteAxiosUrl(config: AxiosRequestConfig): URL {
  try {
    if (config.baseURL) return new URL(String(config.url || ""), config.baseURL);
    return new URL(String(config.url || ""));
  } catch {
    throw new ProviderNetworkError("invalid-target", "上游请求地址无效");
  }
}

function proxyAgentHeaders(token?: string): { headers?: Record<string, string> } {
  return token ? { headers: { "Proxy-Authorization": token } } : {};
}

function controlledAxiosRedirect(
  initialOrigin: string,
  purpose: "api" | "media",
  method: string,
  httpAgent: NodeHttpAgent | HttpProxyAgent<string>,
  httpsAgent: NodeHttpsAgent | HttpsProxyAgent<string>,
): NonNullable<AxiosRequestConfig["beforeRedirect"]> {
  return (redirectOptions) => {
    const raw = redirectOptions as Record<string, any>;
    if (raw.auth) {
      throw new ProviderNetworkError("invalid-target", "上游重定向地址不能包含凭据");
    }
    const protocol = String(raw.protocol || "");
    const hostname = String(raw.hostname || "");
    const port = raw.port ? `:${raw.port}` : "";
    const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
    let nextOrigin = "";
    try {
      nextOrigin = new URL(`${protocol}//${host}${port}`).origin;
    } catch {
      throw new ProviderNetworkError("invalid-target", "上游重定向地址无效");
    }
    assertNetworkTarget(nextOrigin);
    const crossedOrigin = nextOrigin !== initialOrigin;
    if (crossedOrigin && purpose !== "media") {
      throw new ProviderNetworkError("invalid-target", "上游 API 拒绝跨域重定向");
    }
    if (crossedOrigin) {
      if (method !== "GET" && method !== "HEAD") {
        throw new ProviderNetworkError("invalid-target", "媒体请求拒绝携带请求体的跨域重定向");
      }
      stripSensitiveHeaders(raw.headers || {});
    }
    const loopback = isDesktopLoopback(nextOrigin);
    raw.agents = loopback ? { http: directHttpAgent, https: directHttpsAgent } : { http: httpAgent, https: httpsAgent };
    raw.agent = protocol === "https:" ? raw.agents.https : raw.agents.http;
    raw.socketPath = undefined;
  };
}

export function buildAxiosRequestConfig<T = unknown>(
  decision: ProviderEgressDecision,
  config: AxiosRequestConfig<T>,
  options: ProviderTransportOptions = {},
): AxiosRequestConfig<T> {
  const target = absoluteAxiosUrl(config);
  if (decision.mode === "proxy" && isDesktopLoopback(target)) {
    decision = { providerId: decision.providerId, mode: "direct", cacheKey: "direct" };
  }
  const checkedAdapter: typeof nodeAxiosAdapter = async request => {
    assertNetworkTarget(absoluteAxiosUrl(request));
    if (decision.mode === "proxy") assertNetworkTarget(decision.proxyUri);
    const debug = startDebugHttp({ url: axios.getUri(request), method: request.method, headers: request.headers.toJSON(), body: request.data, providerId: decision.providerId, mode: decision.mode });
    try {
      const response = await nodeAxiosAdapter(request);
      debug?.response(response.status, response.headers, response.data);
      return response;
    } catch (error) { debug?.error(error); throw error; }
  };
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new ProviderNetworkError("invalid-target", "上游请求仅支持 HTTP/HTTPS");
  }
  const purpose = options.purpose ?? "api";
  const method = String(config.method || "GET").toUpperCase();
  if (decision.mode === "direct") {
    const httpsAgent = decision.providerId === "kie" ? kieDirectHttpsAgent : directHttpsAgent;
    return {
      ...config,
      proxy: false,
      httpAgent: directHttpAgent,
      httpsAgent,
      adapter: checkedAdapter,
      transport: undefined,
      socketPath: undefined,
      lookup: undefined,
      beforeRedirect: controlledAxiosRedirect(target.origin, purpose, method, directHttpAgent, httpsAgent),
      httpVersion: 1,
    };
  }

  const agentOptions = proxyAgentHeaders(decision.proxyToken);
  const httpAgent = new HttpProxyAgent(decision.proxyUri, agentOptions);
  const httpsAgent = new HttpsProxyAgent(decision.proxyUri, agentOptions);

  return {
    ...config,
    proxy: false,
    httpAgent,
    httpsAgent,
    adapter: checkedAdapter,
    transport: undefined,
    socketPath: undefined,
    lookup: undefined,
    beforeRedirect: controlledAxiosRedirect(target.origin, purpose, method, httpAgent, httpsAgent),
    httpVersion: 1,
  };
}

export async function axiosWithProviderEgress<T = unknown, D = unknown>(
  decision: ProviderEgressDecision,
  config: AxiosRequestConfig<D>,
  options: ProviderTransportOptions = {},
): Promise<AxiosResponse<T, D>> {
  const sensitiveValues = collectProviderRequestSecrets(decision, config);
  try {
    return await isolatedAxios.request<T, AxiosResponse<T, D>, D>(
      buildAxiosRequestConfig(decision, config, options),
    );
  } catch (error) {
    redactProviderAxiosError(error, sensitiveValues);
    throw error;
  }
}

function addSensitiveValue(values: Set<string>, raw: unknown): void {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 3 || value.length > 16_384 || values.size >= 128) return;
  values.add(value);
  const schemeMatch = value.match(/^(?:Bearer|Basic|Key)\s+(.+)$/i);
  const credential = schemeMatch?.[1] || "";
  if (credential.length >= 3) values.add(credential);
  if (/^Basic\s+/i.test(value) && credential) {
    try {
      const decoded = Buffer.from(credential, "base64").toString("utf8");
      if (decoded.length >= 3) values.add(decoded);
      for (const part of decoded.split(":")) if (part.length >= 3) values.add(part);
    } catch {}
  }
  try {
    const parsed = new URL(value);
    values.add(parsed.href);
    if (parsed.pathname.length > 1) values.add(parsed.pathname);
    if (parsed.search.length > 1) values.add(parsed.search);
    for (const item of parsed.searchParams.values()) if (item.length >= 3) values.add(item);
  } catch {}
}

function collectValueLeaves(value: unknown, values: Set<string>, depth = 0): void {
  if (depth > 6 || values.size >= 128 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length <= 1_000_000) {
      try {
        collectValueLeaves(JSON.parse(trimmed), values, depth + 1);
        return;
      } catch {}
    }
    addSensitiveValue(values, value);
    return;
  }
  if (value instanceof URLSearchParams) {
    for (const item of value.values()) addSensitiveValue(values, item);
    return;
  }
  if (typeof value !== "object" || Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 128)) collectValueLeaves(item, values, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 128)) {
    addSensitiveValue(values, key);
    collectValueLeaves(item, values, depth + 1);
  }
}

function collectProviderRequestSecrets(
  decision: ProviderEgressDecision,
  config: AxiosRequestConfig,
): string[] {
  const values = new Set<string>();
  if (decision.mode === "proxy") {
    addSensitiveValue(values, decision.proxyUri);
    addSensitiveValue(values, decision.proxyToken);
  }
  addSensitiveValue(values, config.url);
  addSensitiveValue(values, config.baseURL);
  try {
    const target = absoluteAxiosUrl(config);
    addSensitiveValue(values, target.href);
  } catch {}
  const headers = AxiosHeaders.from(config.headers as any).toJSON();
  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveHeader(name)) addSensitiveValue(values, String(value));
  }
  collectValueLeaves(config.params, values);
  collectValueLeaves(config.data, values);
  collectValueLeaves(config.auth, values);
  return [...values].sort((left, right) => right.length - left.length);
}

function redactResponseText(value: string, sensitiveValues: string[]): string {
  let redacted = value;
  for (const sensitive of sensitiveValues) {
    redacted = redacted.split(sensitive).join("[redacted]");
  }
  return redacted.replace(/https?:\/\/[^\s"'<>\]}),]+/gi, "[redacted-url]");
}

function sanitizeAxiosResponseData(
  value: unknown,
  sensitiveValues: string[],
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > 8 || value === undefined || value === null) return value;
  if (typeof value === "string") return redactResponseText(value, sensitiveValues);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object" || Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return undefined;
  if (seen.has(value)) return "[redacted-circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 256).map((item) => sanitizeAxiosResponseData(item, sensitiveValues, depth + 1, seen));
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 256)) {
    const safeKey = redactResponseText(key, sensitiveValues);
    sanitized[safeKey] = isSensitiveHeader(key)
      ? "[redacted]"
      : sanitizeAxiosResponseData(item, sensitiveValues, depth + 1, seen);
  }
  return sanitized;
}

function redactRequestConfig(config: AxiosRequestConfig | undefined): void {
  if (!config) return;
  delete config.httpAgent;
  delete config.httpsAgent;
  delete config.headers;
  delete config.params;
  delete config.data;
  delete config.auth;
  delete config.url;
  delete config.baseURL;
}

function redactProviderAxiosError(error: unknown, sensitiveValues: string[]): void {
  if (!axios.isAxiosError(error)) return;
  redactRequestConfig(error.config);
  redactRequestConfig(error.response?.config);
  error.request = undefined;
  if (error.response) {
    error.response.request = undefined;
    error.response.statusText = "";
    error.response.headers = new AxiosHeaders();
    error.response.data = sanitizeAxiosResponseData(error.response.data, sensitiveValues);
  }
  const status = Number(error.response?.status || 0);
  error.message = status
    ? `Provider request failed with status code ${status}`
    : error.code
      ? `Provider request failed (${error.code})`
      : "Provider request failed";
  const frames = String(error.stack || "")
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => /^\s*at\s/.test(line));
  error.stack = [`${error.name}: ${error.message}`, ...frames].join("\n");
  try {
    (error as Error & { cause?: unknown }).cause = undefined;
  } catch {
    // Some runtimes expose a read-only cause; message/config/request are already sanitized.
  }
}

export async function directAxios<T = unknown, D = unknown>(
  config: AxiosRequestConfig<D>,
  options: ProviderTransportOptions = {},
): Promise<AxiosResponse<T, D>> {
  return axiosWithProviderEgress<T, D>(
    { providerId: "direct", mode: "direct", cacheKey: "direct" },
    config,
    options,
  );
}

export async function providerAxios<T = unknown, D = unknown>(
  providerId: string,
  config: AxiosRequestConfig<D>,
  options: ProviderTransportOptions = {},
): Promise<AxiosResponse<T, D>> {
  return axiosWithProviderEgress<T, D>(await resolveProviderEgress(providerId), config, options);
}
