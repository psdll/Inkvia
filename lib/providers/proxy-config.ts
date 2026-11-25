import "server-only";

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";

export const SETTING_KEY_PROVIDER_PROXY = "providers.proxy";

export type ProxyOverrideAction =
  | { action: "keep" }
  | { action: "set"; url: string }
  | { action: "disable" }
  | { action: "inherit" }
  | { action: "system" };

export type SafeProxyView = {
  overrideState: "inherit" | "configured" | "disabled" | "invalid" | "system";
  source: "database" | "environment" | "mixed-environment" | "none" | "system";
  system?: SystemProxyView;
  preview: string | null;
  hasCredentials: boolean;
};

export type ResolvedProxy = {
  status: "ready" | "missing" | "invalid";
  source: "database" | "environment" | "none" | "system";
  direct?: boolean;
  uri?: string;
  token?: string;
  preview?: string;
  hasCredentials?: boolean;
  fingerprint?: string;
};

type ParsedProxySecret = {
  storageUrl: string;
  uri: string;
  token?: string;
  preview: string;
  hasCredentials: boolean;
  fingerprint: string;
};

type ProxyClient = {
  appSetting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: string };
      update: { value: string };
    }): Promise<unknown>;
    deleteMany(args: { where: { key: string } }): Promise<unknown>;
  };
};

type ProxyEnvironment = Record<string, string | undefined>;
type SystemProxyView =
  | { status: "direct" | "socks" | "unavailable" }
  | { status: "proxy"; url: string };

let systemCache: { file: string; until: number; state: SystemProxyView } | undefined;

function readSystemProxy(env: ProxyEnvironment): SystemProxyView {
  const file = env.INKVIA_DESKTOP_PROXY_FILE;
  if (!file) return { status: "unavailable" };
  const now = Date.now();
  if (systemCache?.file === file && systemCache.until > now) return systemCache.state;
  let state: SystemProxyView = { status: "unavailable" };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (raw?.status === "direct" || raw?.status === "socks") state = { status: raw.status };
    if (raw?.status === "proxy") {
      const parsed = parseProxyUrlSecret(raw.url);
      if (parsed.ok && !parsed.value.hasCredentials) state = { status: "proxy", url: parsed.value.preview };
    }
  } catch {}
  systemCache = { file, until: now + 750, state };
  return state;
}

function resolveSystemProxy(env: ProxyEnvironment): ResolvedProxy {
  const system = readSystemProxy(env);
  if (system.status === "proxy") {
    const parsed = parseProxyUrlSecret(system.url);
    if (parsed.ok) return fromSecret(parsed.value, "system");
  }
  if (system.status === "direct") return { status: "ready", source: "system", direct: true };
  return { status: system.status === "socks" ? "invalid" : "missing", source: "system" };
}

function firstEnv(env: ProxyEnvironment, names: string[]): string {
  for (const name of names) {
    const upper = String(env[name] ?? "").trim();
    if (upper) return upper;
    const lower = String(env[name.toLowerCase()] ?? "").trim();
    if (lower) return lower;
  }
  return "";
}

function legacyProxyValue(providerId: string, env: ProxyEnvironment): string {
  if (providerId === "google-ai-studio") {
    return firstEnv(env, ["GOOGLE_AI_STUDIO_PROXY_URL", "GEMINI_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"]);
  }
  if (providerId === "apimart") {
    return firstEnv(env, ["APIMART_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"]);
  }
  if (providerId === "easyrouter") {
    return firstEnv(env, ["EASYROUTER_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"]);
  }
  return firstEnv(env, ["HTTPS_PROXY", "HTTP_PROXY"]);
}

function parseProxyUrlSecret(rawValue: unknown, legacy = false):
  | { ok: true; value: ParsedProxySecret }
  | { ok: false; error: string } {
  let raw = String(rawValue ?? "").trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) {
    return { ok: false, error: "代理 URL 为空、过长或包含控制字符" };
  }
  if (legacy && !/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) raw = `http://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "代理 URL 格式无效" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "代理仅支持 HTTP/HTTPS" };
  }
  if (!parsed.hostname || (parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    return { ok: false, error: "代理 URL 不能包含路径、查询参数或片段" };
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "代理端口无效" };
  }

  let username = "";
  let password = "";
  try {
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    return { ok: false, error: "代理凭据编码无效" };
  }
  if (/[\u0000-\u001f\u007f]/.test(username) || /[\u0000-\u001f\u007f]/.test(password) || username.includes(":")) {
    return { ok: false, error: "代理凭据包含不允许的字符" };
  }
  const authority = `${parsed.protocol}//${parsed.hostname}:${port}`;
  const hasCredentials = Boolean(parsed.username || parsed.password);
  const token = hasCredentials
    ? `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
    : undefined;
  return {
    ok: true,
    value: {
      storageUrl: parsed.toString().replace(/\/$/, ""),
      uri: authority,
      preview: authority,
      hasCredentials,
      token,
      fingerprint: createHash("sha256").update(parsed.toString()).digest("hex"),
    },
  };
}

export function validateProxyUrl(raw: string):
  | { ok: true; value: Pick<ParsedProxySecret, "uri" | "preview" | "hasCredentials"> }
  | { ok: false; error: string } {
  const parsed = parseProxyUrlSecret(raw);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: {
      uri: parsed.value.uri,
      preview: parsed.value.preview,
      hasCredentials: parsed.value.hasCredentials,
    },
  };
}

export type ParsedProxyOverride =
  | { state: "inherit" }
  | { state: "configured"; proxy: ParsedProxySecret }
  | { state: "disabled" }
  | { state: "invalid" };

export function parseProxyOverride(raw: string | null, desktop = false): ParsedProxyOverride {
  if (raw === null) return { state: "inherit" };
  try {
    const value = JSON.parse(raw) as { version?: unknown; state?: unknown; url?: unknown };
    if (value?.version !== 1) return { state: "invalid" };
    if (desktop && value.state === "inherit") return { state: "inherit" };
    if (value.state === "disabled") return { state: "disabled" };
    if (value.state !== "configured" || typeof value.url !== "string") return { state: "invalid" };
    const parsed = parseProxyUrlSecret(value.url);
    return parsed.ok ? { state: "configured", proxy: parsed.value } : { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

function fromSecret(proxy: ParsedProxySecret, source: "database" | "environment" | "system"): ResolvedProxy {
  return {
    status: "ready",
    source,
    uri: proxy.uri,
    token: proxy.token,
    preview: proxy.preview,
    hasCredentials: proxy.hasCredentials,
    fingerprint: proxy.fingerprint,
  };
}

export function resolveProviderProxyFromRaw(
  providerId: string,
  raw: string | null,
  env: ProxyEnvironment = process.env,
): ResolvedProxy {
  const desktop = env.INKVIA_DESKTOP_MODE === "1";
  const override = parseProxyOverride(raw, desktop);
  if (override.state === "configured") return fromSecret(override.proxy, "database");
  if (override.state === "disabled") return { status: "missing", source: "none" };
  if (override.state === "invalid") return { status: "invalid", source: "none" };

  if (desktop && raw === null) return resolveSystemProxy(env);
  const inherited = legacyProxyValue(providerId, env);
  if (!inherited) return desktop ? resolveSystemProxy(env) : { status: "missing", source: "none" };
  const parsed = parseProxyUrlSecret(inherited, true);
  return parsed.ok
    ? fromSecret(parsed.value, "environment")
    : { status: "invalid", source: "environment" };
}

export function buildProxySafeView(raw: string | null, env: ProxyEnvironment = process.env): SafeProxyView {
  const view = buildProxyView(raw, env);
  return env.INKVIA_DESKTOP_MODE === "1" ? { ...view, system: readSystemProxy(env) } : view;
}

function buildProxyView(raw: string | null, env: ProxyEnvironment): SafeProxyView {
  const desktop = env.INKVIA_DESKTOP_MODE === "1";
  const override = parseProxyOverride(raw, desktop);
  if (override.state === "configured") {
    return {
      overrideState: "configured",
      source: "database",
      preview: override.proxy.preview,
      hasCredentials: override.proxy.hasCredentials,
    };
  }
  if (override.state === "disabled") {
    return { overrideState: "disabled", source: "none", preview: null, hasCredentials: false };
  }
  if (override.state === "invalid") {
    return { overrideState: "invalid", source: "none", preview: null, hasCredentials: false };
  }

  const google = resolveProviderProxyFromRaw("google-ai-studio", raw, env);
  const apimart = resolveProviderProxyFromRaw("apimart", raw, env);
  if (desktop && google.source === "system" && apimart.source === "system") {
    const system = readSystemProxy(env);
    return {
      overrideState: raw === null ? "system" : "inherit",
      source: "system",
      preview: system.status === "proxy" ? system.url : null,
      hasCredentials: false,
    };
  }
  if (google.status === "missing" && apimart.status === "missing") {
    return { overrideState: "inherit", source: "none", preview: null, hasCredentials: false };
  }
  const ready = [google, apimart].filter((item) => item.status === "ready");
  const hasCredentials = ready.some((item) => item.hasCredentials === true);
  if (google.status !== "ready" || apimart.status !== "ready") {
    return { overrideState: "inherit", source: "mixed-environment", preview: null, hasCredentials };
  }
  const fingerprints = new Set(ready.map((item) => item.fingerprint));
  if (fingerprints.size > 1) {
    return { overrideState: "inherit", source: "mixed-environment", preview: null, hasCredentials };
  }
  return {
    overrideState: "inherit",
    source: "environment",
    preview: ready[0].preview ?? null,
    hasCredentials,
  };
}

export async function readProxySettingRaw(client: ProxyClient = prisma): Promise<string | null> {
  const row = await client.appSetting.findUnique({ where: { key: SETTING_KEY_PROVIDER_PROXY } });
  return row?.value ?? null;
}

export async function resolveProviderProxy(providerId: string, client: ProxyClient = prisma): Promise<ResolvedProxy> {
  return resolveProviderProxyFromRaw(providerId, await readProxySettingRaw(client));
}

export async function getProxySafeView(client: ProxyClient = prisma): Promise<SafeProxyView> {
  return buildProxySafeView(await readProxySettingRaw(client));
}

export function buildProxyOverrideCandidate(
  currentRaw: string | null,
  input: ProxyOverrideAction,
): string | null {
  if (input.action === "keep") return currentRaw;
  if (input.action === "system") {
    if (process.env.INKVIA_DESKTOP_MODE !== "1") throw new Error("代理动作无效");
    return null;
  }
  if (input.action === "inherit") return process.env.INKVIA_DESKTOP_MODE === "1"
    ? JSON.stringify({ version: 1, state: "inherit" })
    : null;
  if (input.action === "disable") return JSON.stringify({ version: 1, state: "disabled" });
  const parsed = parseProxyUrlSecret(input.url);
  if (!parsed.ok) throw new Error(parsed.error);
  return JSON.stringify({ version: 1, state: "configured", url: parsed.value.storageUrl });
}

export async function applyProxyOverrideAction(client: ProxyClient, input: ProxyOverrideAction): Promise<void> {
  if (input.action === "keep") return;
  const value = buildProxyOverrideCandidate(null, input);
  if (value === null) {
    await client.appSetting.deleteMany({ where: { key: SETTING_KEY_PROVIDER_PROXY } });
    return;
  }
  await client.appSetting.upsert({
    where: { key: SETTING_KEY_PROVIDER_PROXY },
    create: { key: SETTING_KEY_PROVIDER_PROXY, value },
    update: { value },
  });
}
