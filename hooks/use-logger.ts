"use client";

import { useCallback } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

export function useLogger() {
  const { user } = useAuth();

  const logAction = useCallback(async (
    action: string,
    message: string,
    metadata?: Record<string, any>
  ) => {
    if (!user?.id) return;

    try {
      await fetch("/api/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          action,
          message,
          metadata,
        }),
      });
    } catch (error) {
      // 页面跳转或刷新时上报被中断不需要打到控制台
      if ((error as { name?: string } | null)?.name === "AbortError") return;
    }
  }, [user?.id]);

  return { logAction };
}
