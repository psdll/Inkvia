import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  ProviderRegistryConfigurationError,
  getBuiltinProviders,
  getEffectiveProviders,
  getRegisteredProviders,
} from "@/lib/providers/registry";
import {
  SETTING_KEY_PROVIDER_PROXY,
  applyProxyOverrideAction,
  buildProxySafeView,
  parseProxyOverride,
  resolveProviderProxyFromRaw,
  validateProxyUrl,
} from "@/lib/providers/proxy-config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("provider egress defaults", () => {
  it("assigns the required direct/proxy matrix to every builtin provider", () => {
    const modes = Object.fromEntries(getBuiltinProviders().map((provider) => [provider.id, provider.egressMode]));

    expect(modes).toEqual({
      apimart: "proxy",
      kie: "direct",
      jiekou: "direct",
      volcengine: "direct",
      "google-ai-studio": "proxy",
      reapi: "direct",
      "aicoming-haiya": "direct",
      deepseek: "direct",
      minimax: "direct",
      tuzi: "direct",
      bailian: "direct",
      "volcengine-speech": "direct",
      "volcengine-mediakit": "direct",
      bigmodel: "direct",
      "work-fisher": "direct",
      openrouter: "proxy",
    });
  });
});

describe("proxy URL validation", () => {
  it("returns only a credential-free validation view", () => {
    const result = validateProxyUrl("http://alice:p%40ss@127.0.0.1:7890");

    expect(result).toMatchObject({
      ok: true,
      value: {
        uri: "http://127.0.0.1:7890",
        preview: "http://127.0.0.1:7890",
        hasCredentials: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("alice");
    expect(JSON.stringify(result)).not.toContain("p%40ss");
    expect(JSON.stringify(result)).not.toContain("YWxpY2U6cEBzcw==");
    expect(result.ok && "token" in result.value).toBe(false);
  });

  it("always includes the effective port in the safe preview", () => {
    expect(validateProxyUrl("http://proxy.example.test")).toMatchObject({
      ok: true,
      value: { preview: "http://proxy.example.test:80" },
    });
    expect(validateProxyUrl("https://proxy.example.test")).toMatchObject({
      ok: true,
      value: { preview: "https://proxy.example.test:443" },
    });
  });

  it.each([
    "socks5://127.0.0.1:1080",
    "http://127.0.0.1:7890/path",
    "http://127.0.0.1:7890?x=1",
    "http://127.0.0.1:7890#x",
    "http://127.0.0.1:99999",
    "http://",
    "http://bad%3Aname:secret@127.0.0.1:7890",
    `http://127.0.0.1:7890/${"x".repeat(2050)}`,
  ])("rejects an unsafe proxy URL: %s", (raw) => {
    expect(validateProxyUrl(raw)).toMatchObject({ ok: false });
  });
});

describe("proxy override state", () => {
  it("distinguishes inherit, configured, disabled and invalid rows", () => {
    expect(parseProxyOverride(null).state).toBe("inherit");
    expect(parseProxyOverride(JSON.stringify({ version: 1, state: "configured", url: "http://127.0.0.1:7890" })).state).toBe("configured");
    expect(parseProxyOverride(JSON.stringify({ version: 1, state: "disabled" })).state).toBe("disabled");
    expect(parseProxyOverride("not-json").state).toBe("invalid");
    expect(parseProxyOverride(JSON.stringify({ version: 2, state: "disabled" })).state).toBe("invalid");
  });

  it("uses provider-specific legacy environment precedence only while inheriting", () => {
    const env = {
      GOOGLE_AI_STUDIO_PROXY_URL: "http://google-proxy:7001",
      GEMINI_PROXY_URL: "http://gemini-proxy:7002",
      APIMART_PROXY_URL: "http://apimart-proxy:7003",
      EASYROUTER_PROXY_URL: "http://easyrouter-proxy:7005",
      HTTPS_PROXY: "http://shared-proxy:7004",
    };

    expect(resolveProviderProxyFromRaw("google-ai-studio", null, env)).toMatchObject({ status: "ready", source: "environment", preview: "http://google-proxy:7001" });
    expect(resolveProviderProxyFromRaw("apimart", null, env)).toMatchObject({ status: "ready", source: "environment", preview: "http://apimart-proxy:7003" });
    expect(resolveProviderProxyFromRaw("easyrouter", null, env)).toMatchObject({ status: "ready", source: "environment", preview: "http://easyrouter-proxy:7005" });
    expect(resolveProviderProxyFromRaw("custom-example", null, env)).toMatchObject({ status: "ready", source: "environment", preview: "http://shared-proxy:7004" });

    const disabled = JSON.stringify({ version: 1, state: "disabled" });
    expect(resolveProviderProxyFromRaw("google-ai-studio", disabled, env)).toMatchObject({ status: "missing", source: "none" });
  });

  it("accepts lowercase legacy proxy variables when uppercase variables are empty", () => {
    expect(resolveProviderProxyFromRaw("apimart", null, {
      APIMART_PROXY_URL: "",
      apimart_proxy_url: "http://lowercase-proxy:7890",
    })).toMatchObject({ status: "ready", preview: "http://lowercase-proxy:7890" });
  });

  it("fails closed when the persisted row or selected inherited value is invalid", () => {
    expect(resolveProviderProxyFromRaw("apimart", "not-json", { HTTPS_PROXY: "http://shared:7890" })).toMatchObject({ status: "invalid", source: "none" });
    expect(resolveProviderProxyFromRaw("google-ai-studio", null, { GOOGLE_AI_STUDIO_PROXY_URL: "socks5://127.0.0.1:1080", HTTPS_PROXY: "http://shared:7890" })).toMatchObject({ status: "invalid", source: "environment" });
  });

  it("reports mixed inherited Google and APIMart proxies without exposing credentials", () => {
    const view = buildProxySafeView(null, {
      GOOGLE_AI_STUDIO_PROXY_URL: "http://user:secret@google-proxy:7001",
      APIMART_PROXY_URL: "http://apimart-proxy:7002",
    });

    expect(view).toEqual({
      overrideState: "inherit",
      source: "mixed-environment",
      preview: null,
      hasCredentials: true,
    });
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(JSON.stringify(view)).not.toContain("user");
  });

  it("reports partially missing or invalid inherited provider proxies as mixed", () => {
    expect(buildProxySafeView(null, {
      GOOGLE_AI_STUDIO_PROXY_URL: "socks5://127.0.0.1:1080",
      APIMART_PROXY_URL: "http://apimart-proxy:7002",
    })).toMatchObject({ overrideState: "inherit", source: "mixed-environment", preview: null });

    expect(buildProxySafeView(null, {
      GOOGLE_AI_STUDIO_PROXY_URL: "http://google-proxy:7001",
    })).toMatchObject({ overrideState: "inherit", source: "mixed-environment", preview: null });
  });

  it("keeps historical custom providers out of automatic legacy LLM fallback", async () => {
    const client = {
      appSetting: {
        findUnique: async ({ where }: any) => where.key === "providers.registry"
          ? { value: JSON.stringify([{
              id: "custom-legacy",
              name: "Legacy",
              protocol: "openai",
              baseUrl: "https://example.test/v1",
              imageModels: [],
              videoModels: [],
              chatModels: ["chat-model"],
              modelProtocols: {},
              enabled: true,
              sortOrder: 99,
            }]) }
          : null,
      },
    } as any;

    const provider = (await getRegisteredProviders(client)).find((item) => item.id === "custom-legacy");
    expect(provider).toMatchObject({ egressMode: "direct", allowLegacyFallback: false });
  });

  it("keeps an invalid persisted egress visible to admin but out of runtime providers", async () => {
    const client = {
      appSetting: {
        findUnique: async ({ where }: any) => where.key === "providers.registry"
          ? { value: JSON.stringify([{ id: "kie", egressMode: "sometimes" }]) }
          : null,
      },
    } as any;

    const registered = await getRegisteredProviders(client);
    expect(registered.find((provider) => provider.id === "kie")).toMatchObject({
      configurationError: "invalid-egress",
    });
    expect((await getEffectiveProviders(client)).some((provider) => provider.id === "kie")).toBe(false);
  });

  it.each([null, ""])("treats a present non-string egress value as invalid: %s", async (egressMode) => {
    const client = {
      appSetting: {
        findUnique: async ({ where }: any) => where.key === "providers.registry"
          ? { value: JSON.stringify([{ id: "kie", egressMode }]) }
          : null,
      },
    } as any;

    const registered = await getRegisteredProviders(client);
    expect(registered.find((provider) => provider.id === "kie")).toMatchObject({
      configurationError: "invalid-egress",
    });
    expect((await getEffectiveProviders(client)).some((provider) => provider.id === "kie")).toBe(false);
  });

  it.each([
    "",
    "{",
    "{}",
    "null",
    "[null]",
    '[{"id":"kie"},{"id":"kie"}]',
  ])("fails closed for a corrupt persisted provider registry: %s", async (value) => {
    const client = {
      appSetting: {
        findUnique: async ({ where }: any) => where.key === "providers.registry" ? { value } : null,
      },
    } as any;

    await expect(getRegisteredProviders(client)).rejects.toBeInstanceOf(ProviderRegistryConfigurationError);
    await expect(getEffectiveProviders(client)).rejects.toBeInstanceOf(ProviderRegistryConfigurationError);
  });

  it("applies keep, set, disable and inherit without conflating their meaning", async () => {
    const rows = new Map<string, string>();
    rows.set(SETTING_KEY_PROVIDER_PROXY, JSON.stringify({ version: 1, state: "configured", url: "http://old:7890" }));
    const client = {
      appSetting: {
        findUnique: async ({ where }: any) => rows.has(where.key) ? { value: rows.get(where.key)! } : null,
        upsert: async ({ where, create, update }: any) => {
          rows.set(where.key, update.value ?? create.value);
          return { key: where.key, value: rows.get(where.key)! };
        },
        deleteMany: async ({ where }: any) => ({ count: rows.delete(where.key) ? 1 : 0 }),
      },
    } as any;

    await applyProxyOverrideAction(client, { action: "keep" });
    expect(JSON.parse(rows.get(SETTING_KEY_PROVIDER_PROXY)!)).toMatchObject({ state: "configured", url: "http://old:7890" });

    await applyProxyOverrideAction(client, { action: "set", url: "http://new:7891" });
    expect(JSON.parse(rows.get(SETTING_KEY_PROVIDER_PROXY)!)).toEqual({ version: 1, state: "configured", url: "http://new:7891" });

    await applyProxyOverrideAction(client, { action: "disable" });
    expect(JSON.parse(rows.get(SETTING_KEY_PROVIDER_PROXY)!)).toEqual({ version: 1, state: "disabled" });

    await applyProxyOverrideAction(client, { action: "inherit" });
    expect(rows.has(SETTING_KEY_PROVIDER_PROXY)).toBe(false);
  });
});
