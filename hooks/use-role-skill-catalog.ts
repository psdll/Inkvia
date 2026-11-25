"use client";

import * as React from "react";
import { getCachedRoleSkillData, listRoleSkills } from "@/lib/role-skills/client";
import type {
  RoleSkillListItem,
  RoleSkillMediaType,
} from "@/lib/role-skills/contracts";

const cachedCatalog = () => getCachedRoleSkillData<{ skills: RoleSkillListItem[] }>("/api/role-skills")?.skills;

export function filterRoleSkillSuggestions(
  skills: RoleSkillListItem[],
  query: string,
) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return skills;
  return skills.filter((skill) =>
    [skill.name, skill.summary, skill.category, skill.usageScenario].some(
      (value) => value.toLowerCase().includes(keyword),
    ),
  );
}

export function filterRoleSkillsByMediaType(
  skills: RoleSkillListItem[],
  _mediaType?: RoleSkillMediaType,
) {
  // All pages share the account catalog; media type is only a creation default.
  return skills;
}

export function useRoleSkillCatalog({
  authUserId,
  enabled,
  mediaType,
}: {
  authUserId: string;
  enabled: boolean;
  mediaType?: RoleSkillMediaType;
}) {
  const [skills, setSkills] = React.useState<RoleSkillListItem[]>(() => authUserId ? cachedCatalog() || [] : []);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestRef = React.useRef(0);

  const refresh = React.useCallback(async () => {
    if (!authUserId) {
      setSkills([]);
      setError(null);
      return [];
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(!cachedCatalog());
    setError(null);
    try {
      const next = await listRoleSkills();
      if (requestRef.current !== requestId) return next;
      setSkills(next);
      return next;
    } catch (requestError) {
      if (requestRef.current === requestId) {
        setError(
          requestError instanceof Error ? requestError.message : "技能目录加载失败",
        );
      }
      return [];
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [authUserId]);

  React.useEffect(() => {
    requestRef.current += 1;
    if (!authUserId) {
      setSkills([]);
      setLoading(false);
      setError(null);
      return;
    }
    setSkills(cachedCatalog() || []);
  }, [authUserId]);

  React.useEffect(() => {
    if (!enabled || !authUserId) return;
    void refresh();
  }, [authUserId, enabled, refresh]);

  React.useEffect(() => {
    const changed = () => { if (enabled && authUserId) void refresh(); };
    const logout = () => { requestRef.current += 1; setSkills([]); setLoading(false); };
    window.addEventListener("role-skills:changed", changed);
    window.addEventListener("auth:logout", logout);
    return () => {
      window.removeEventListener("role-skills:changed", changed);
      window.removeEventListener("auth:logout", logout);
    };
  }, [authUserId, enabled, refresh]);

  const availableSkills = React.useMemo(
    () => filterRoleSkillsByMediaType(skills, mediaType),
    [mediaType, skills],
  );

  return { skills: availableSkills, loading, error, refresh };
}
