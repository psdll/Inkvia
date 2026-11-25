"use client";

import * as React from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type {
  PromptPresetDto,
  PromptPresetInput,
} from "@/lib/prompt-presets/contracts";

type UserPromptStore = {
  presets: PromptPresetDto[] | null;
  pending: Promise<PromptPresetDto[]> | null;
  generation: number;
  loading: boolean;
  error: string | null;
  view: PromptPresetView;
};

type PromptPresetView = {
  presets: PromptPresetDto[];
  loading: boolean;
  error: string | null;
};

const EMPTY_PRESETS: PromptPresetDto[] = [];
const NO_USER_VIEW: PromptPresetView = {
  presets: EMPTY_PRESETS,
  loading: false,
  error: null,
};

async function readError(response: Response, fallback: string) {
  const json = await response.json().catch(() => null);
  return String(json?.error || fallback);
}

export function createPromptPresetStore() {
  const users = new Map<string, UserPromptStore>();
  const listeners = new Set<() => void>();
  let activeUserKey: string | null = null;
  let promptChannel: BroadcastChannel | null = null;

  const userStore = (userKey: string) => {
    let store = users.get(userKey);
    if (!store) {
      store = {
        presets: null,
        pending: null,
        generation: 0,
        loading: false,
        error: null,
        view: NO_USER_VIEW,
      };
      users.set(userKey, store);
    }
    return store;
  };

  const notify = (userKey: string | null) => {
    if (userKey === activeUserKey) {
      listeners.forEach((listener) => listener());
    }
  };

  const updateView = (userKey: string) => {
    const store = userStore(userKey);
    const presets = store.presets || EMPTY_PRESETS;
    if (
      store.view.presets === presets &&
      store.view.loading === store.loading &&
      store.view.error === store.error
    ) {
      return;
    }
    store.view = {
      presets,
      loading: store.loading,
      error: store.error,
    };
    notify(userKey);
  };

  const publish = (userKey: string, presets: PromptPresetDto[]) => {
    const store = userStore(userKey);
    store.presets = presets;
    updateView(userKey);
  };

  const requestPresets = async (userKey: string, force = false) => {
    const store = userStore(userKey);
    if (!force && store.presets !== null) return store.presets;
    if (store.pending) return store.pending;

    const requestGeneration = store.generation;
    store.loading = true;
    store.error = null;
    updateView(userKey);

    const request = fetch("/api/prompt-presets", { method: "GET" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readError(response, "提示词加载失败"));
        }
        const json = await response.json().catch(() => null);
        const presets = Array.isArray(json?.presets)
          ? (json.presets as PromptPresetDto[])
          : [];
        if (requestGeneration === store.generation) {
          publish(userKey, presets);
        }
        return presets;
      })
      .catch((error) => {
        if (requestGeneration === store.generation) {
          store.error =
            error instanceof Error ? error.message : "提示词加载失败";
          updateView(userKey);
        }
        throw error;
      })
      .finally(() => {
        if (store.pending === request) {
          store.pending = null;
          store.loading = false;
          updateView(userKey);
        }
      });

    store.pending = request;
    return request;
  };

  const refresh = async (userKey: string, clear: boolean) => {
    const store = userStore(userKey);
    store.generation += 1;
    store.error = null;
    if (clear) store.presets = null;
    updateView(userKey);

    const previous = store.pending;
    if (previous) await previous.catch(() => undefined);
    if (activeUserKey !== userKey) return store.presets || EMPTY_PRESETS;
    return requestPresets(userKey, true);
  };

  const invalidateDormantUser = (userKey: string) => {
    const store = userStore(userKey);
    store.generation += 1;
    store.presets = null;
    store.error = null;
    updateView(userKey);
  };

  const ensurePromptChannel = () => {
    if (
      promptChannel ||
      typeof BroadcastChannel === "undefined"
    ) {
      return;
    }
    promptChannel = new BroadcastChannel("prompt-presets");
    promptChannel.addEventListener("message", (event) => {
      const userKey = String(event.data?.userKey || "");
      if (!userKey || userKey !== activeUserKey) return;
      void refresh(userKey, true).catch(() => undefined);
    });
  };

  const broadcastInvalidation = (userKey: string) => {
    ensurePromptChannel();
    promptChannel?.postMessage({ type: "invalidate", userKey });
  };

  const requireActiveUser = () => {
    if (!activeUserKey) throw new Error("请先登录");
    return activeUserKey;
  };

  const mutate = async (
    request: () => Promise<Response>,
    applyResult: (
      current: PromptPresetDto[],
      result: PromptPresetDto | null,
    ) => PromptPresetDto[],
  ) => {
    const userKey = requireActiveUser();
    const store = userStore(userKey);
    const mutationGeneration = store.generation;
    try {
      const response = await request();
      if (!response.ok) {
        throw new Error(await readError(response, "提示词保存失败"));
      }
      const result = response.status === 204
        ? null
        : ((await response.json().catch(() => null)) as PromptPresetDto | null);
      broadcastInvalidation(userKey);
      if (activeUserKey !== userKey) {
        invalidateDormantUser(userKey);
        return result;
      }
      const hasTrustedBaseline =
        store.presets !== null && mutationGeneration === store.generation;
      if (hasTrustedBaseline) {
        publish(userKey, applyResult(store.presets!, result));
      }
      await refresh(userKey, !hasTrustedBaseline);
      return result;
    } catch (error) {
      if (activeUserKey !== userKey) {
        invalidateDormantUser(userKey);
        throw error;
      }
      await refresh(userKey, true).catch(() => undefined);
      throw error;
    }
  };

  return {
    setUser(userKey: string | null) {
      ensurePromptChannel();
      if (activeUserKey === userKey) return;
      activeUserKey = userKey;
      listeners.forEach((listener) => listener());
      if (userKey && userStore(userKey).presets === null) {
        void refresh(userKey, true).catch(() => undefined);
      }
    },
    getUserKey() {
      return activeUserKey;
    },
    getSnapshot() {
      return activeUserKey
        ? userStore(activeUserKey).view
        : NO_USER_VIEW;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async reload() {
      return refresh(requireActiveUser(), true);
    },
    createPreset(value: PromptPresetInput) {
      return mutate(
        () =>
          fetch("/api/prompt-presets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(value),
          }),
        (current, result) => (result ? [result, ...current] : current),
      );
    },
    updatePreset(preset: PromptPresetDto, value: PromptPresetInput) {
      return mutate(
        () =>
          fetch(`/api/prompt-presets/${encodeURIComponent(preset.id)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              expectedRevision: preset.revision,
              value,
            }),
          }),
        (current, result) => {
          const publicId = preset.id;
          const remaining = current.filter(
            (preset) => preset.id !== publicId,
          );
          return result ? [result, ...remaining] : remaining;
        },
      );
    },
    deletePreset(preset: PromptPresetDto) {
      return mutate(
        () =>
          fetch(`/api/prompt-presets/${encodeURIComponent(preset.id)}`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ expectedRevision: preset.revision }),
          }),
        (current) => current.filter((item) => item.id !== preset.id),
      );
    },
  };
}

const promptPresetStore = createPromptPresetStore();

export function usePromptPresets() {
  const { user, loading: authLoading } = useAuth();
  const userKey = !authLoading && user ? String(user.id) : null;
  const snapshot = React.useSyncExternalStore(
    promptPresetStore.subscribe,
    promptPresetStore.getSnapshot,
    promptPresetStore.getSnapshot,
  );

  React.useEffect(() => {
    if (authLoading) return;
    promptPresetStore.setUser(user ? String(user.id) : null);
  }, [authLoading, user]);

  const storeMatchesUser = promptPresetStore.getUserKey() === userKey;
  const view = storeMatchesUser && userKey ? snapshot : NO_USER_VIEW;
  return {
    presets: view.presets,
    loading:
      authLoading ||
      Boolean(userKey && !storeMatchesUser) ||
      view.loading,
    error: view.error,
    reload: promptPresetStore.reload,
    createPreset: promptPresetStore.createPreset,
    updatePreset: promptPresetStore.updatePreset,
    deletePreset: promptPresetStore.deletePreset,
  };
}
