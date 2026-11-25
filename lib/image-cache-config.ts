/**
 * 图片缓存预热的集中配置 + 设备/网络自适应。
 *
 * 设计目标：
 * 1. 所有 warmResilientImageCandidatesBatch 调用点都从这里取参数，杜绝散落硬编码。
 * 2. 在弱网（saveData / 慢 effectiveType）或低配机（hardwareConcurrency < 4）下自动降级或跳过，
 *    避免在员工低端笔记本 + 4G 热点场景下把 CPU / 流量打爆。
 * 3. 与 woolly-dreaming-kernighan.md plan 文件里"非后悔决策第 5 条"对应。
 */

export type WarmPreset = "inspiration" | "library" | "works" | "admin-works";

export type WarmParams = {
  limit: number;
  batchSize: number;
  delayMs: number;
};

const BASE_PRESETS: Record<WarmPreset, WarmParams> = {
  // 首页灵感发现：进首页就触发，但用户可能马上离开，限制条数
  inspiration: { limit: 60, batchSize: 6, delayMs: 80 },
  // 素材库面板：员工操作主入口，命中率最高，多预热一些
  library: { limit: 160, batchSize: 6, delayMs: 80 },
  // 资产：列表稍密，但访问频率次于素材库
  works: { limit: 60, batchSize: 6, delayMs: 90 },
  // 管理员看其他人的资产：低优先级，慢一点更稳
  "admin-works": { limit: 80, batchSize: 4, delayMs: 120 }
};

type ConnectionLike = {
  saveData?: boolean;
  effectiveType?: string;
};

function readConnection(): ConnectionLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { connection?: ConnectionLike };
  return nav.connection || null;
}

function readHardwareConcurrency(): number {
  if (typeof navigator === "undefined") return 8;
  const value = Number((navigator as Navigator).hardwareConcurrency);
  return Number.isFinite(value) && value > 0 ? value : 8;
}

/**
 * 根据当前设备 / 网络条件，对给定 preset 做自适应调整。
 * 返回 null 表示「这种条件下应该完全跳过预热」。
 */
export function getWarmParams(preset: WarmPreset): WarmParams | null {
  const base = BASE_PRESETS[preset];
  if (!base) return null;

  // SSR / Node 环境，沿用基础值即可（实际上不会真正预热）
  if (typeof window === "undefined") return base;

  const conn = readConnection();
  const cores = readHardwareConcurrency();

  // ① 用户明确开了「省流量」模式 → 完全跳过预热
  if (conn?.saveData === true) return null;

  // ② 极慢网络 → 完全跳过预热
  const effectiveType = String(conn?.effectiveType || "").toLowerCase();
  if (effectiveType === "slow-2g" || effectiveType === "2g") return null;

  // ③ 慢 3G → 大幅降级
  if (effectiveType === "3g") {
    return {
      limit: Math.max(10, Math.floor(base.limit * 0.3)),
      batchSize: Math.max(2, Math.floor(base.batchSize / 2)),
      delayMs: base.delayMs * 2
    };
  }

  // ④ 老旧笔记本（< 4 核）→ 降低并行度，延长间隔
  if (cores < 4) {
    return {
      limit: Math.max(20, Math.floor(base.limit * 0.6)),
      batchSize: Math.max(2, Math.floor(base.batchSize / 2)),
      delayMs: Math.floor(base.delayMs * 1.5)
    };
  }

  // ⑤ 文档当前不可见（用户切走了）→ 跳过，避免后台空跑
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return null;
  }

  return base;
}
