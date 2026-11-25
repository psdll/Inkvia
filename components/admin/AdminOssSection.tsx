"use client";
import { UiText, UiProps } from "@/i18n/ui";


import Link from "next/link";
import { Copy, Database, FolderDown, HardDrive, Package2 } from "lucide-react";

const SHARED_IMAGE_PATH = "uploads/products/shared/image/YYYY-MM-DD/product_时间戳_文件名";
const SHARED_VIDEO_PATH = "uploads/products/shared/video/YYYY-MM-DD/product_时间戳_文件名";
const PRIVATE_IMAGE_PATH = "uploads/products/private/user_{用户名}/image/YYYY-MM-DD/product_时间戳_文件名";
const PRIVATE_VIDEO_PATH = "uploads/products/private/user_{用户名}/video/YYYY-MM-DD/product_时间戳_文件名";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch {}
}

export default function AdminOssSection() {
  return (
    <div id="sys-oss" className="scroll-mt-28 2xl:col-span-2 rounded-3xl border border-white/10 bg-[var(--panel-bg)]/92 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-[var(--app-fg)] flex items-center gap-2 mb-2">
            <HardDrive className="h-4 w-4 text-blue-400" /><UiText id="admin.m5439f0dffe53" /></h3>
          <p className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.mf2911221b1e5" /></p>
        </div>
        <Link
          href="/admin/materials?from=product"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 text-[13px] text-emerald-600 transition hover:bg-emerald-500/15 dark:text-emerald-300"
        >
          <Package2 className="h-4 w-4" /><UiText id="admin.m65cd85ea605f" /></Link>
      </div>

      <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m6a958b6dabde" /></div>
              <div className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.me385fbd0bf40" /></div>
            </div>
            <Database className="h-4 w-4 text-[var(--app-muted)]" />
          </div>

          <div className="mt-4 space-y-3">
            <UiProps ids={{"label":["admin.me275c8d63448"]}}><PathRow label="admin.me275c8d63448" path={SHARED_IMAGE_PATH} /></UiProps>
            <UiProps ids={{"label":["admin.m258c10d8f15e"]}}><PathRow label="admin.m258c10d8f15e" path={SHARED_VIDEO_PATH} /></UiProps>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[var(--panel-2)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m1c676c2ef3f9" /></div>
              <div className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.mfbdefdbf6a29" /></div>
            </div>
            <FolderDown className="h-4 w-4 text-[var(--app-muted)]" />
          </div>

          <div className="mt-4 space-y-3">
            <UiProps ids={{"label":["admin.m407587ee6b62"]}}><PathRow label="admin.m407587ee6b62" path={PRIVATE_IMAGE_PATH} /></UiProps>
            <UiProps ids={{"label":["admin.md2e868a53300"]}}><PathRow label="admin.md2e868a53300" path={PRIVATE_VIDEO_PATH} /></UiProps>
          </div>
        </div>
      </div>

    </div>
  );
}

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-[var(--app-fg)]">{label}</div>
        <button
          type="button"
          onClick={() => void copyText(path)}
          className="h-7 px-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition inline-flex items-center gap-1"
        >
          <Copy className="h-3 w-3" /><UiText id="admin.m63d90d977348" /></button>
      </div>
      <div className="mt-2 break-all rounded-lg bg-black/10 px-3 py-2 font-mono text-[11px] text-[var(--app-fg)]">
        {path}
      </div>
    </div>
  );
}
