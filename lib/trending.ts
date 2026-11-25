import "server-only";

import { prisma } from "@/lib/prisma";

/** 微博、知乎热榜，供 Agent 的「查看热点」工具使用；结果在数据库里缓存几个小时。 */
export type TrendingItem = {
  keyword: string;
  rank?: number;
  heat?: string;
  category?: string;
  platform: TrendingPlatform;
};

export type TrendingPlatform = "weibo" | "zhihu";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const CACHE_HOURS: Record<TrendingPlatform, number> = { weibo: 2, zhihu: 3 };

function uniqByKeyword(items: TrendingItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.keyword.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

async function fetchWeibo(): Promise<TrendingItem[]> {
  const json = await fetchJson("https://weibo.com/ajax/side/hotSearch", { Referer: "https://weibo.com/" });
  const list: any[] = Array.isArray(json?.data?.realtime) ? json.data.realtime : [];
  return list.filter((item) => item?.word).slice(0, 20).map((item, index) => ({
    keyword: String(item.word).trim(),
    rank: index + 1,
    heat: item.num ? String(item.num) : undefined,
    category: item.category ? String(item.category) : "社会",
    platform: "weibo",
  }));
}

async function fetchZhihu(): Promise<TrendingItem[]> {
  const json = await fetchJson("https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=20", { "x-requested-with": "fetch" });
  const list: any[] = Array.isArray(json?.data) ? json.data : [];
  return list.filter((item) => item?.target?.title).slice(0, 20).map((item, index) => ({
    keyword: String(item.target.title).trim(),
    rank: index + 1,
    heat: item.detail_text ? String(item.detail_text) : undefined,
    category: "社会",
    platform: "zhihu",
  }));
}

const FETCHERS: Record<TrendingPlatform, () => Promise<TrendingItem[]>> = { weibo: fetchWeibo, zhihu: fetchZhihu };

async function cache(platform: TrendingPlatform, items: TrendingItem[]) {
  const expiresAt = new Date(Date.now() + CACHE_HOURS[platform] * 3600 * 1000);
  await prisma.trendingTopic.deleteMany({ where: { platform } });
  await prisma.trendingTopic.createMany({
    data: items.map((item) => ({ platform, keyword: item.keyword, rank: item.rank ?? null, heat: item.heat ?? null, category: item.category ?? null, expiresAt })),
  });
}

export async function getTrending(platforms: TrendingPlatform[] = ["weibo", "zhihu"]): Promise<TrendingItem[]> {
  const cached = await prisma.trendingTopic.findMany({
    where: { platform: { in: platforms }, expiresAt: { gt: new Date() } },
    orderBy: [{ platform: "asc" }, { rank: "asc" }, { fetchedAt: "desc" }],
    take: 40,
  });
  if (cached.length) {
    return uniqByKeyword(cached.map((row) => ({
      keyword: row.keyword,
      rank: row.rank ?? undefined,
      heat: row.heat ?? undefined,
      category: row.category ?? undefined,
      platform: row.platform as TrendingPlatform,
    })));
  }

  const results: TrendingItem[] = [];
  for (const platform of platforms) {
    try {
      const items = await FETCHERS[platform]();
      results.push(...items);
      if (items.length) await cache(platform, items);
    } catch (error) {
      console.warn(`[trending] ${platform} fetch failed:`, error);
    }
  }
  return uniqByKeyword(results);
}
