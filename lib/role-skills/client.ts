import type {
  AdminRoleSkillDetail,
  AdminRoleSkillListItem,
  PersonalRoleSkillInput,
  RoleSkillDetail,
  RoleSkillListItem,
  RoleSkillStatus,
  SystemRoleSkillInput,
} from "@/lib/role-skills/contracts";
import type { RoleSkillFeatureKey } from "@/lib/role-skills/features";

const SKILL_CACHE_TTL = 5 * 60 * 1000;
const SKILL_CACHE_CHANGE_KEY = "role-skills-cache-change";
type CacheEntry = { value?: unknown; expiresAt: number; pending?: Promise<unknown> };
let responseCaches = new WeakMap<typeof fetch, Map<string, CacheEntry>>();
let cacheGeneration = 0;

export function invalidateRoleSkillCache(broadcast = true, notify = true) {
  responseCaches = new WeakMap();
  cacheGeneration += 1;
  if (typeof window !== "undefined") {
    if (notify) window.dispatchEvent(new Event("role-skills:changed"));
    if (broadcast) {
      try { window.localStorage.setItem(SKILL_CACHE_CHANGE_KEY, `${Date.now()}:${Math.random()}`); } catch {}
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:logout", () => invalidateRoleSkillCache(false, false));
  window.addEventListener("storage", (event) => {
    if (event.key === SKILL_CACHE_CHANGE_KEY) invalidateRoleSkillCache(false);
  });
}

export function getCachedRoleSkillData<T>(url: string, fetchImpl: typeof fetch = fetch): T | undefined {
  return responseCaches.get(fetchImpl)?.get(url)?.value as T | undefined;
}

async function readCachedRoleSkillResponse<T>(url: string, fallback: string, fetchImpl: typeof fetch): Promise<T> {
  let cache = responseCaches.get(fetchImpl);
  if (!cache) { cache = new Map(); responseCaches.set(fetchImpl, cache); }
  const cached = cache.get(url);
  if (cached?.pending) return cached.pending as Promise<T>;
  if (cached?.value !== undefined && cached.expiresAt > Date.now()) return cached.value as T;
  const generation = cacheGeneration;
  const entry: CacheEntry = { value: cached?.value, expiresAt: 0 };
  entry.pending = fetchImpl(url, { cache: "no-store" })
    .then((response) => readRoleSkillResponse<T>(response, fallback))
    .then((value) => {
      if (generation === cacheGeneration) {
        cache!.set(url, { value, expiresAt: Date.now() + SKILL_CACHE_TTL });
        while (cache!.size > 80) cache!.delete(cache!.keys().next().value!);
      }
      return value;
    }, (error) => {
      if (cache!.get(url) === entry) cache!.delete(url);
      if (error?.status === 401 || error?.status === 403) invalidateRoleSkillCache(false, false);
      throw error;
    });
  cache.set(url, entry);
  return entry.pending as Promise<T>;
}

async function readRoleSkillResponse<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    const error = new Error(String(data?.error || fallback)) as Error & {
      code?: string;
      status?: number;
    };
    error.code = String(data?.code || "");
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export async function listRoleSkills(fetchImpl: typeof fetch = fetch) {
  const data = await readCachedRoleSkillResponse<{ skills: RoleSkillListItem[] }>("/api/role-skills", "技能目录加载失败", fetchImpl);
  return Array.isArray(data.skills) ? data.skills : [];
}

export async function getPersonalRoleSkillClient(
  skillId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const data = await readCachedRoleSkillResponse<{ skill: RoleSkillDetail }>(`/api/role-skills/personal/${encodeURIComponent(skillId)}`, "个人技能加载失败", fetchImpl);
  return data.skill;
}

export async function getSystemRoleSkillClient(
  skillId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const data = await readCachedRoleSkillResponse<{ skill: RoleSkillDetail }>(`/api/role-skills/system/${encodeURIComponent(skillId)}`, "系统技能加载失败", fetchImpl);
  return data.skill;
}

export async function createPersonalRoleSkillClient(
  value: PersonalRoleSkillInput,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("/api/role-skills/personal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const data = await readRoleSkillResponse<{ skill: RoleSkillDetail }>(
    response,
    "个人技能创建失败",
  );
  invalidateRoleSkillCache();
  return data.skill;
}

export async function updatePersonalRoleSkillClient(
  skillId: string,
  value: PersonalRoleSkillInput,
  expectedRevision: number,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `/api/role-skills/personal/${encodeURIComponent(skillId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...value, expectedRevision }),
    },
  );
  const data = await readRoleSkillResponse<{ skill: RoleSkillDetail }>(
    response,
    "个人技能保存失败",
  );
  invalidateRoleSkillCache();
  return data.skill;
}

export async function deletePersonalRoleSkillClient(
  skillId: string,
  expectedRevision: number,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `/api/role-skills/personal/${encodeURIComponent(skillId)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    },
  );
  await readRoleSkillResponse(response, "个人技能删除失败");
  invalidateRoleSkillCache();
}

export async function uploadPersonalRoleSkillCover(
  file: File,
  fetchImpl: typeof fetch = fetch,
) {
  const form = new FormData();
  form.set("file", file);
  const response = await fetchImpl("/api/role-skills/personal/cover", {
    method: "POST",
    body: form,
  });
  const data = await readRoleSkillResponse<{ coverUrl: string }>(
    response,
    "技能封面上传失败",
  );
  return data.coverUrl;
}

export async function deletePersonalRoleSkillCoverClient(
  coverUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("/api/role-skills/personal/cover", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coverUrl }),
  });
  await readRoleSkillResponse(response, "技能封面清理失败");
}

export async function listSystemRoleSkillsAdmin(
  fetchImpl: typeof fetch = fetch,
) {
  const data = await readCachedRoleSkillResponse<{ skills: AdminRoleSkillListItem[] }>("/api/admin/role-skills/system?includeDeleted=1", "系统技能加载失败", fetchImpl);
  return Array.isArray(data.skills) ? data.skills : [];
}

export async function getSystemRoleSkillAdmin(
  skillId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const data = await readCachedRoleSkillResponse<{ skill: AdminRoleSkillDetail }>(`/api/admin/role-skills/system/${encodeURIComponent(skillId)}`, "系统技能加载失败", fetchImpl);
  return data.skill;
}

export async function createSystemRoleSkillAdmin(
  value: SystemRoleSkillInput,
  status: RoleSkillStatus,
  featureKeys: RoleSkillFeatureKey[] = [],
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("/api/admin/role-skills/system", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...value, status, featureKeys }),
  });
  const data = await readRoleSkillResponse<{ skill: AdminRoleSkillDetail }>(
    response,
    "系统技能创建失败",
  );
  invalidateRoleSkillCache();
  return data.skill;
}

export async function updateSystemRoleSkillAdmin(
  skillId: string,
  value: SystemRoleSkillInput,
  status: RoleSkillStatus,
  expectedRevision: number,
  featureKeys: RoleSkillFeatureKey[] = [],
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `/api/admin/role-skills/system/${encodeURIComponent(skillId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...value, status, expectedRevision, featureKeys }),
    },
  );
  const data = await readRoleSkillResponse<{ skill: AdminRoleSkillDetail }>(
    response,
    "系统技能保存失败",
  );
  invalidateRoleSkillCache();
  return data.skill;
}

export async function deleteSystemRoleSkillAdmin(
  skillId: string,
  expectedRevision: number,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `/api/admin/role-skills/system/${encodeURIComponent(skillId)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    },
  );
  await readRoleSkillResponse(response, "系统技能删除失败");
  invalidateRoleSkillCache();
}

export async function restoreSystemRoleSkillAdmin(
  skillId: string,
  expectedRevision: number,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `/api/admin/role-skills/system/${encodeURIComponent(skillId)}/restore`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    },
  );
  await readRoleSkillResponse(response, "系统技能恢复失败");
  invalidateRoleSkillCache();
}

export async function uploadSystemRoleSkillCover(
  file: File,
  fetchImpl: typeof fetch = fetch,
) {
  const form = new FormData();
  form.set("file", file);
  const response = await fetchImpl("/api/admin/role-skills/system/cover", {
    method: "POST",
    body: form,
  });
  const data = await readRoleSkillResponse<{ coverUrl: string }>(
    response,
    "系统技能封面上传失败",
  );
  return data.coverUrl;
}

export async function deleteSystemRoleSkillCoverClient(
  coverUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("/api/admin/role-skills/system/cover", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coverUrl }),
  });
  await readRoleSkillResponse(response, "系统技能封面清理失败");
}
