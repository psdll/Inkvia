import { fetchJsonOnce } from "@/lib/client/inflight-json";
// 系统设置「账号与用户名分配」面板的内存缓存。
// 作用：面板刷新会重挂载组件，借此缓存让重挂载时秒显示上次数据、后台再静默刷新。
// 任何会改变用户集合 / 统计的操作（新增白名单、删除用户、清理数据等）都应调用 clearAuthUsersCache()，
// 这样下次进入面板会强制拉取最新数据，不会显示过期缓存。

export type CachedWhitelistItem = {
  id: number;
  name: string;
  createdAt: string;
  materialUploadAllowed?: boolean;
  inspirationTemplateUploadAllowed?: boolean;
};
export type CachedAuthUser = {
  id: number;
  username: string;
  createdAt: string;
  generationCount: number;
  passwordResetAllowed?: boolean;
  materialUploadAllowed?: boolean;
  inspirationTemplateUploadAllowed?: boolean;
};
export type AuthUsersCache = { whitelist: CachedWhitelistItem[]; users: CachedAuthUser[];
  pagination?: { page: number; pageSize: number; total: number; hasMore: boolean } };


let cacheEpoch = 0;
const pages = new Map<string, { data: AuthUsersCache; at: number }>();

export function getAuthUsersCache(key = ''): AuthUsersCache | null {
  const cached = pages.get(key);
  if (!cached || Date.now() - cached.at > 60_000) { pages.delete(key); return null; }
  pages.delete(key); pages.set(key, cached);
  return cached.data;
}

export function setAuthUsersCache(next: AuthUsersCache | null, key = '') {
  if (!next) { pages.delete(key); return; }
  const data = next ? { whitelist: next.whitelist.map(item => ({ id: item.id, name: item.name, createdAt: item.createdAt, materialUploadAllowed: item.materialUploadAllowed, inspirationTemplateUploadAllowed: item.inspirationTemplateUploadAllowed })),
    users: next.users.map(user => ({ id: user.id, username: user.username, createdAt: user.createdAt, generationCount: user.generationCount,
      passwordResetAllowed: user.passwordResetAllowed, materialUploadAllowed: user.materialUploadAllowed,
      inspirationTemplateUploadAllowed: user.inspirationTemplateUploadAllowed })), pagination: next.pagination } : null;
  if (data) { pages.delete(key); pages.set(key, { data, at: Date.now() }); }
  while (pages.size > 4) pages.delete(pages.keys().next().value!);
}

export function clearAuthUsersCache() {
  cacheEpoch++;
  pages.clear();
  warming = null;
}

let warming: Promise<void> | null = null;
export function warmAuthUsers(): Promise<void> {
  if (getAuthUsersCache()) return Promise.resolve();
  if (warming) return warming;
  const epoch = cacheEpoch;
  const request = fetchJsonOnce<AuthUsersCache>('/api/admin/auth-users?view=page&page=1&q=')
    .then(({ok,json}) => { if (epoch === cacheEpoch && ok && json && Array.isArray(json.users) && Array.isArray(json.whitelist)) setAuthUsersCache(json); })
    .catch(() => {}).finally(() => { if (warming === request) warming = null; });
  warming = request;
  return request;
}
