"use client";

import * as React from "react";
import { creativeAgentClient, CreativeAgentClientError } from "@/lib/creative-agent/client";
import type { CreativeAgentSessionSummary } from "@/lib/creative-agent/contracts";

export function useConversationTabs(canvasId: number) {
  const [sessions, setSessions] = React.useState<CreativeAgentSessionSummary[]>([]);
  const [openIds, setOpenIds] = React.useState<string[]>([]);
  const [mountedIds, setMountedIds] = React.useState<string[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");
  const alive = React.useRef(true);
  const createLock = React.useRef(false);
  const titleRequests = React.useRef(new Set<string>());
  const tabsKey = `creative-agent:tabs:v1:${canvasId}`;
  const creationKey = `creative-agent:new-session:v1:${canvasId}`;
  const pendingCreation = React.useRef<string | null>(null);

  const updateSession = React.useCallback((session: CreativeAgentSessionSummary) => {
    setSessions(current => {
      const existing = current.find(item => item.id === session.id);
      if (existing && Date.parse(existing.updatedAt) > Date.parse(session.updatedAt)) return current;
      return existing
        ? current.map(item => item.id === session.id ? session : item)
        : [session, ...current];
    });
  }, []);

  const open = React.useCallback((id: string) => {
    setOpenIds(current => current.includes(id) ? current : [...current, id]);
    setMountedIds(current => current.includes(id) ? current : [...current, id]);
    setActiveId(id);
  }, []);

  const create = React.useCallback(async () => {
    if (createLock.current) return;
    createLock.current = true;
    setCreating(true);
    setError("");
    try {
      if (!pendingCreation.current) {
        try { pendingCreation.current = sessionStorage.getItem(creationKey); } catch { /* Storage is optional. */ }
        pendingCreation.current ||= crypto.randomUUID();
        try { sessionStorage.setItem(creationKey, pendingCreation.current); } catch { /* Keep the request ID in memory. */ }
      }
      const { session } = await creativeAgentClient.createSession(canvasId, pendingCreation.current);
      pendingCreation.current = null;
      try { sessionStorage.removeItem(creationKey); } catch { /* Storage is optional. */ }
      if (!alive.current) return;
      updateSession(session);
      open(session.id);
    } catch (reason) {
      if (reason instanceof CreativeAgentClientError && reason.status !== null && reason.status < 500) {
        pendingCreation.current = null;
        try { sessionStorage.removeItem(creationKey); } catch { /* Storage is optional. */ }
      }
      if (alive.current) setError(reason instanceof Error ? reason.message : "新建对话失败，请重试。");
    } finally {
      createLock.current = false;
      if (alive.current) setCreating(false);
    }
  }, [canvasId, creationKey, open, updateSession]);

  React.useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    void creativeAgentClient.sessions(canvasId, abort.signal).then(async ({ sessions: items }) => {
      if (abort.signal.aborted) return;
      setSessions(items);
      for (const item of items) {
        let legacyTitle = "";
        try { legacyTitle = sessionStorage.getItem(`canvas-agent:title:${item.id}`) || ""; } catch { /* Storage is optional. */ }
        if (legacyTitle.trim() && item.titleSource !== "manual") {
          try {
            const { session } = await creativeAgentClient.renameSession(canvasId, item.id, legacyTitle.trim().slice(0, 80));
            if (abort.signal.aborted) return;
            updateSession(session);
            try { sessionStorage.removeItem(`canvas-agent:title:${item.id}`); } catch { /* Server title is already saved. */ }
          } catch { /* Keep the old name for a later migration attempt. */ }
        }
      }
      let saved: { openIds?: string[]; activeId?: string } = {};
      try { saved = JSON.parse(localStorage.getItem(tabsKey) || "{}") || {}; } catch { /* Use latest session. */ }
      const savedIds = Array.isArray(saved.openIds)
        ? [...new Set(saved.openIds)].filter(id => items.some(item => item.id === id))
        : [];
      const primary = [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))[0]?.id;
      const ids = primary ? [primary, ...savedIds.filter(id => id !== primary)] : savedIds;
      setOpenIds(ids);
      setMountedIds(ids);
      setActiveId(saved.activeId && ids.includes(saved.activeId) ? saved.activeId : ids[0] || null);
      if (!ids.length) await create();
      if (!abort.signal.aborted) setReady(true);
    }).catch(reason => {
      if (!abort.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "读取对话失败。");
        setReady(true);
      }
    });
    return () => { alive.current = false; abort.abort(); };
  }, [canvasId, tabsKey, create, updateSession]);

  React.useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(tabsKey, JSON.stringify({ openIds, activeId })); } catch { /* Keep the mounted tabs. */ }
  }, [ready, tabsKey, openIds, activeId]);

  const refresh = React.useCallback(async () => {
    try {
      const { sessions: items } = await creativeAgentClient.sessions(canvasId);
      if (alive.current) items.forEach(updateSession);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : "读取历史失败。");
    }
  }, [canvasId, updateSession]);

  const rename = async (id: string, title: string) => {
    setError("");
    try {
      const { session } = await creativeAgentClient.renameSession(canvasId, id, title);
      if (alive.current) updateSession(session);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : "修改名称失败。");
    }
  };

  const summarize = React.useCallback(async (id: string, messageId: string) => {
    const key = `${id}:${messageId}`;
    if (titleRequests.current.has(key)) return;
    titleRequests.current.add(key);
    try {
      const { session } = await creativeAgentClient.summarizeSession(canvasId, id);
      if (alive.current) updateSession(session);
    } catch {
      // A title failure never interrupts the conversation or repeats a paid request.
    }
  }, [canvasId, updateSession]);

  return { sessions, openIds, mountedIds, activeId, ready, creating, error, open, create, refresh, rename, summarize };
}

export type ConversationTabs = ReturnType<typeof useConversationTabs>;
