// 供应商动态注册表 —— 类型定义。
//
// 设计要点（见 plan）：
//   - API Key 可作为服务端 saved key 持久化，也可通过 envKeyName 从环境变量回退读取。
//   - admin API 永不返回 saved key 明文，只公开 hasKey、掩码和来源。
//
// 协议集合对齐无限画布 main.py 的 SUPPORTED_PROVIDER_PROTOCOLS。

import type { LlmProtocol } from "@/lib/llm-routing/adapters/types";

export type ProviderProtocol =
  | "openai"
  | "apimart"
  | "gemini"
  | "volcengine"
  | "jimeng";

export type ProviderModelKind = "image" | "video" | "audio" | "chat";
export type ProviderEgressMode = "direct" | "proxy";

/** 持久化到 AppSetting 的供应商配置；可包含仅服务端使用的 saved key。 */
export interface ProviderConfig {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  /** Key 所在的环境变量名；saved key 为空时作为内建平台的回退。 */
  envKeyName?: string;
  /** Explicit network path for every request owned by this provider. */
  egressMode: ProviderEgressMode;
  /** Custom providers opt out so merely saving a model can never take over legacy routing. */
  allowLegacyFallback?: boolean;
  /** Runtime-only validation marker; never accepted as an admin write field. */
  configurationError?: "invalid-egress";
  /** Optional server-side saved key. Admin APIs must never return this field. */
  apiKey?: string;
  /** Transient admin request flag; when true, remove the saved key. */
  clearApiKey?: boolean;
  /** LLM gateway protocol used by server-side route resolution. */
  llmProtocol?: LlmProtocol;
  /** Relative OpenAI-compatible endpoint path; supports only the {model} placeholder. */
  llmEndpointTemplate?: string;
  imageModels: string[];
  videoModels: string[];
  audioModels?: string[];
  chatModels: string[];
  /** 逐模型协议覆盖：modelId -> protocol（覆盖平台全局协议）。 */
  modelProtocols: Record<string, ProviderProtocol>;
  imageRequestMode?: "openai" | "openai-json";
  registerUrl?: string;
  /** Platform homepage / console, shown in admin so others can see which platform this is. */
  websiteUrl?: string;
  enabled: boolean;
  sortOrder: number;
}

/** 运行期解析后的供应商；apiKey 优先取 saved key、再回退 env；不得直接返回 admin UI。 */
export interface ResolvedProvider {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  hasKey: boolean;
  envKeyName?: string;
  egressMode: ProviderEgressMode;
  allowLegacyFallback: boolean;
  configurationError?: "invalid-egress";
  llmProtocol?: LlmProtocol;
  llmEndpointTemplate?: string;
  imageModels: string[];
  videoModels: string[];
  audioModels?: string[];
  chatModels: string[];
  modelProtocols: Record<string, ProviderProtocol>;
  imageRequestMode?: "openai" | "openai-json";
}

/** admin UI 渲染推荐平台卡用的元数据（移植自 api-settings.js 的 RECOMMENDED_APIS）。 */
export interface RecommendedProvider {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  envKeyName?: string;
  registerUrl?: string;
  /** 卖点短句，用于卡片展示。 */
  advantages: string[];
  /** 标签：image/video/chat 三选若干。 */
  kinds: ProviderModelKind[];
  /** 一键添加时预填的默认模型清单。 */
  imageModels?: string[];
  videoModels?: string[];
  audioModels?: string[];
  chatModels?: string[];
  modelProtocols?: Record<string, ProviderProtocol>;
  imageRequestMode?: "openai" | "openai-json";
  /** 是否置顶/推荐徽章。 */
  featured?: boolean;
}
