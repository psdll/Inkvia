"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";
import { Database, RefreshCw, Trash2 } from "lucide-react";
import { adminDisplayName } from "@/lib/admin-utils";

type ActiveUserLite = {
  adminKey: string;
  userId: string;
  username?: string | null;
  authUserId?: number | null;
  lastCreatedAt?: string | null;
};

type UserDetailHeaderProps = {
  activeUser: string;
  activeUserItem: ActiveUserLite | null;
  entryActionBusy: "" | "purge" | "delete_user";
  onRequestPurge: () => void;
  onRequestDelete: () => void;
};

export default function UserDetailHeader({
  activeUser,
  activeUserItem,
  entryActionBusy,
  onRequestPurge,
  onRequestDelete,
}: UserDetailHeaderProps) {
  return (
    <>
      <div className="rounded-3xl border border-white/10 bg-[var(--panel-bg)]/92 p-5 shadow-sm flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--app-muted)]"><UiText id="admin.ma569c636d974" /></div>
          <div className="text-[16px] font-semibold text-[var(--app-fg)] break-all mt-1">
            {activeUserItem ? adminDisplayName(activeUserItem) : "--"}
          </div>
          {activeUserItem && <div className="text-[11px] text-[var(--app-muted)] break-all mt-0.5">UID: {activeUserItem.userId}</div>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!activeUser || !!entryActionBusy}
            onClick={onRequestPurge}
            className="h-9 px-4 rounded-xl bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-400 disabled:opacity-50 transition flex items-center gap-2"
          >
            {entryActionBusy === "purge" ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /><UiText id="admin.m3b7250886cb6" /></>
            ) : (
              <>
                <Database className="h-4 w-4" /><UiText id="admin.m429e20ec3a93" /></>
            )}
          </button>
          <button
            type="button"
            disabled={!activeUserItem || !!entryActionBusy}
            onClick={onRequestDelete}
            className="h-9 px-4 rounded-xl bg-rose-600 text-white text-[12px] font-semibold hover:bg-rose-500 disabled:opacity-50 transition flex items-center gap-2"
          >
            {entryActionBusy === "delete_user" ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /><UiText id="admin.m3b7250886cb6" /></>
            ) : (
              <>
                <Trash2 className="h-4 w-4" /><UiText id="admin.me2ca08b38511" /></>
            )}
          </button>
        </div>
      </div>

    </>
  );
}
