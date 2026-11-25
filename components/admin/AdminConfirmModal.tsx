"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";
import { formatUiNumber } from "@/i18n/format";
import type { UiLocale } from "@/i18n/locale";


import * as React from "react";
import { RefreshCw } from "lucide-react";
import { useDesktopMode } from "@/components/system/desktop-mode";

const CLEANUP_CONFIRM_PHRASE = "删除全站用户旧任务作品";

export type ConfirmAction =
  | { type: "delete_user"; userId: string; authUserId?: number | null; adminKey?: string }
  | { type: "delete_generation"; id: number; generationType?: string }
  | { type: "delete_inspiration_template"; templateId: number; generationId: number }
  | { type: "bulk_delete_imports"; userId: string; authUserId?: number | null; count: number }
  | { type: "delete_failed_generations"; userId: string; authUserId?: number | null; count: number }
  | { type: "bulk_delete_generations"; ids: number[] }
  | { type: "delete_feedback"; id: number }
  | { type: "delete_preset"; userId: string; authUserId?: number | null; scope: string; presetId: string; presetName: string }
  | { type: "purge_presets"; userId: string; authUserId?: number | null }
  | { type: "delete_builtin_preset"; scope: string; presetId: string; presetName: string }
  | { type: "cleanup_storage"; action: "cleanup_old_uploads" | "cleanup_temp" | "cleanup_thumbnail_assets"; title: string }
  | { type: "release_material_asset"; assetId: number };

type AdminConfirmModalProps = {
  action: ConfirmAction | null;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (adminPassword?: string) => void;
  onPasswordInput?: () => void;
};

function describeAction(action: ConfirmAction, desktopMode: boolean, locale: UiLocale, text: ReturnType<typeof useUiLocale>["text"]): string {
  switch (action.type) {
    case "cleanup_storage":
      if (action.action === "cleanup_old_uploads") {
        if (desktopMode) {
          return text("adminStorage.cleanupLocal", { v0: action.title });
        }
        return text("adminStorage.cleanupAll", { v0: action.title });
      }
      return action.action === "cleanup_thumbnail_assets"
        ? text("adminStorage.cleanupThumbs", { v0: action.title })
        : text("adminStorage.cleanupTemp", { v0: action.title });
    case "delete_user":
      return text("adminStorage.deleteUser", { v0: action.userId });
    case "delete_generation":
      return action.generationType === "import"
        ? text("adminStorage.deleteImport", { v0: action.id })
        : text("adminStorage.deleteGeneration", { v0: action.id });
    case "delete_inspiration_template":
      return text("adminStorage.deleteInspiration", { v0: action.generationId, v1: action.templateId });
    case "bulk_delete_imports":
      return text("adminStorage.bulkDeleteImports", { v0: formatUiNumber(locale, action.count, undefined, () => String(action.count)) });
    case "delete_failed_generations":
      return text("adminStorage.deleteFailed", { v0: formatUiNumber(locale, action.count, undefined, () => String(action.count)) });
    case "bulk_delete_generations":
      return text("adminStorage.bulkDelete", { v0: formatUiNumber(locale, action.ids.length, undefined, () => String(action.ids.length)) });
    case "delete_feedback":
      return text("adminStorage.deleteFeedback", { v0: action.id });
    case "purge_presets":
      return text("adminStorage.purgePresets", { v0: action.userId });
    case "delete_builtin_preset":
      return text("adminStorage.deleteBuiltinPreset", { v0: action.presetName });
    case "delete_preset":
      return text("adminStorage.deletePreset", { v0: action.presetName });
    case "release_material_asset":
      return text("adminStorage.releaseMaterial", { v0: action.assetId });
  }
}

export default function AdminConfirmModal({
  action,
  busy,
  error,
  onCancel,
  onConfirm,
  onPasswordInput
}: AdminConfirmModalProps) {
  const { text, locale, error: uiError } = useUiLocale();
  const desktopMode = useDesktopMode();
  const [adminPassword, setAdminPassword] = React.useState("");
  const [confirmationText, setConfirmationText] = React.useState("");
  const [finalConfirmArmed, setFinalConfirmArmed] = React.useState(false);

  React.useEffect(() => {
    if (action) {
      setAdminPassword("");
      setConfirmationText("");
      setFinalConfirmArmed(false);
    }
  }, [action, locale]);

  if (!action) return null;
  const isCriticalStorageCleanup = action.type === "cleanup_storage"
    && action.action === "cleanup_old_uploads";
  const isThumbnailStorageCleanup = action.type === "cleanup_storage"
    && action.action === "cleanup_thumbnail_assets";
  const requiresAdminPassword = action.type === "delete_user" || isCriticalStorageCleanup || isThumbnailStorageCleanup;
  const typedConfirmationPhrase = isCriticalStorageCleanup
    ? locale === "en"
      ? text(desktopMode ? "adminStorage.typedLocal" : "adminStorage.typedAll")
      : desktopMode ? "删除本机旧任务作品" : CLEANUP_CONFIRM_PHRASE
    : null;
  const typedConfirmationMatches = !typedConfirmationPhrase
    || confirmationText.trim() === typedConfirmationPhrase;
  const canConfirm = !busy
    && (!requiresAdminPassword || !!adminPassword.trim())
    && typedConfirmationMatches;

  const submit = () => {
    if (!canConfirm) return;
    if (requiresAdminPassword && !finalConfirmArmed) {
      setFinalConfirmArmed(true);
      return;
    }
    onConfirm(requiresAdminPassword ? adminPassword.trim() : undefined);
  };

  return (
    <div className="fixed inset-0 z-[180] grid place-items-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => { if (!busy) onCancel(); }}
      />
      <div className="relative w-full max-w-[520px] rounded-2xl border border-[var(--border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow)] p-5">
        <div className="text-[15px] font-semibold text-[var(--app-fg)]">
          {isCriticalStorageCleanup ? <UiText id="admin.mb7a01aee4592" /> : <UiText id="admin.mf8347f9a9dcc" />}
        </div>
        {isCriticalStorageCleanup ? (
          <div className="mt-3 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2.5 text-[12px] font-semibold leading-5 text-rose-600">
            {desktopMode ? <UiText id="admin.m300338b5714f" /> : <UiText id="admin.m1ded8ae7aeb0" />}
          </div>
        ) : null}
        <div className="mt-3 text-[13px] text-[var(--app-muted)] whitespace-pre-wrap break-words">
          {describeAction(action, desktopMode, locale, text)}
        </div>
        {requiresAdminPassword ? (
          <div className="mt-4 space-y-2">
            <label className="block text-xs font-medium text-[var(--app-fg)]"><UiText id="admin.mc19091521d71" /></label>
            <UiProps ids={{"placeholder":["admin.m1a4e08f372ef"]}}><input
              type="password"
              value={adminPassword}
              onChange={(event) => {
                setAdminPassword(event.target.value);
                setFinalConfirmArmed(false);
                onPasswordInput?.();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="admin.m1a4e08f372ef"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
              autoFocus
            /></UiProps>
            {finalConfirmArmed ? (
              <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600">
                {isCriticalStorageCleanup
                  ? <UiText id="admin.m278fdec6adbd" />
                  : <UiText id="admin.m5147a24c30d9" />}
              </p>
            ) : (
              <p className="text-xs text-[var(--app-muted)]">
                {isCriticalStorageCleanup
                  ? <UiText id="admin.me3dc5d607aad" />
                  : <UiText id="admin.m2d3f881de478" />}
              </p>
            )}
          </div>
        ) : null}
        {typedConfirmationPhrase ? (
          <div className="mt-4 space-y-2">
            <label className="block text-xs font-medium text-[var(--app-fg)]"><UiText id="admin.m09531cf25979" />{typedConfirmationPhrase}<UiText id="admin.m896241829610" /></label>
            <input
              type="text"
              value={confirmationText}
              onChange={(event) => {
                setConfirmationText(event.target.value);
                setFinalConfirmArmed(false);
                onPasswordInput?.();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={typedConfirmationPhrase}
              autoComplete="off"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-rose-500/20"
            />
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600">
            {uiError(error)}
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-9 px-4 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[13px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50 disabled:pointer-events-none transition"
          ><UiText id="admin.m2cd0f3be8738" /></button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={submit}
            className="h-9 px-4 rounded-xl bg-rose-600 text-white text-[13px] font-semibold hover:bg-rose-500 disabled:opacity-50 disabled:pointer-events-none transition"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" /><UiText id="admin.m2ca049d69ce1" /></span>
            ) : requiresAdminPassword && finalConfirmArmed ? (
              action.type === "delete_user" ? <UiText id="admin.mc30615f49419" /> : <UiText id="admin.ma372aa5dbcde" />
            ) : isCriticalStorageCleanup ? (
              <UiText id="admin.m04e93d92d8bc" />
            ) : action.type === "cleanup_storage" ? (
              <UiText id="admin.m7ba2d6728fe2" />
            ) : action.type === "release_material_asset" ? (
              <UiText id="admin.m2381510341cf" />
            ) : (
              <UiText id="admin.ma3ea3c17b401" />
            )}
          </button>
        </div>
        {busy ? (
          <div className="mt-3 text-[12px] text-[var(--app-muted)]">
            {action.type === "release_material_asset" ? <UiText id="admin.m6024da734848" /> : <UiText id="admin.m0600856f7742" />}
          </div>
        ) : null}
      </div>
    </div>
  );
}
