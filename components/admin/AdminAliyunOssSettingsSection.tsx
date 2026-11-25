"use client";

import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { Cloud, Info, Loader2, Save, ShieldCheck } from "lucide-react";

type VisibleConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  publicBaseUrl: string;
  accessKeySecretConfigured: boolean;
};

type Snapshot = {
  source: "database" | "environment";
  ready: boolean;
  updatedAt: string | null;
  config: VisibleConfig;
};

type FormState = Omit<VisibleConfig, "accessKeySecretConfigured"> & {
  accessKeySecret: string;
};

const EMPTY_FORM: FormState = {
  endpoint: "",
  region: "",
  bucket: "",
  accessKeyId: "",
  accessKeySecret: "",
  publicBaseUrl: "",
};

function formFromSnapshot(snapshot: Snapshot): FormState {
  return {
    endpoint: snapshot.config.endpoint,
    region: snapshot.config.region,
    bucket: snapshot.config.bucket,
    accessKeyId: snapshot.config.accessKeyId,
    accessKeySecret: "",
    publicBaseUrl: snapshot.config.publicBaseUrl,
  };
}

function sourceLabel(source: Snapshot["source"] | undefined) {
  if (source === "database") return "后台保存";
  if (source === "environment") return "环境变量";
  return "读取中";
}

export default function AdminAliyunOssSettingsSection() {
  const { label: uiLabel, error: uiError, locale: uiLocale } = useUiLocale();
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [savedForm, setSavedForm] = React.useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const applySnapshot = React.useCallback((next: Snapshot) => {
    const nextForm = formFromSnapshot(next);
    setSnapshot(next);
    setForm(nextForm);
    setSavedForm(nextForm);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const { ok, json: body } = await fetchJsonOnce<
        { success?: boolean; error?: string } & Partial<Snapshot>
      >("/api/admin/settings/aliyun-oss");
      if (
        !ok ||
        !body?.success ||
        !body.config ||
        !body.source
      ) {
        throw new Error(body?.error || "读取 OSS 配置失败");
      }
      applySnapshot(body as Snapshot);
    } catch (error) {
      setNotice({
        type: "err",
        text: error instanceof Error
          ? error.message
          : "读取 OSS 配置失败",
      });
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const canSave = Boolean(
    snapshot &&
      form.endpoint.trim() &&
      form.region.trim() &&
      form.bucket.trim() &&
      form.accessKeyId.trim() &&
      (
        form.accessKeySecret.trim() ||
        snapshot.config.accessKeySecretConfigured
      ),
  );
  const dirty = snapshot?.source === "environment" ||
    JSON.stringify(form) !== JSON.stringify(savedForm);

  const save = React.useCallback(async () => {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/settings/aliyun-oss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: form }),
      });
      const body = await response.json().catch(() => null) as
        | ({ success?: boolean; error?: string } & Partial<Snapshot>)
        | null;
      if (
        !response.ok ||
        !body?.success ||
        !body.config ||
        !body.source
      ) {
        throw new Error(body?.error || "保存 OSS 配置失败");
      }
      applySnapshot(body as Snapshot);
      setNotice({ type: "ok", text: "OSS 配置已保存并立即生效" });
    } catch (error) {
      setNotice({
        type: "err",
        text: error instanceof Error
          ? error.message
          : "保存 OSS 配置失败",
      });
    } finally {
      setSaving(false);
    }
  }, [applySnapshot, form]);

  const fields: Array<{
    key: keyof FormState;
    label: string;
    placeholder: string;
    hint: string;
    optional?: boolean;
  }> = [
    {
      key: "endpoint",
      label: "Endpoint",
      placeholder: "oss-cn-hangzhou.aliyuncs.com",
      hint:
        "填 Bucket 所在地域的外网 Endpoint。不要带 https://，也不要包含 Bucket 名称。获取：OSS 控制台 → Bucket → 概览 → Endpoint。",
    },
    {
      key: "region",
      label: "Region",
      placeholder: "oss-cn-hangzhou",
      hint:
        "填 ali-oss SDK 地域，例如 oss-cn-hangzhou，必须与 Bucket 所在地域一致。注意这里需要 oss- 前缀。",
    },
    {
      key: "bucket",
      label: "Bucket",
      placeholder: "your-bucket",
      hint:
        "只填存储空间名称，不要填 URL 或目录路径。获取：OSS 控制台 → Bucket 列表。",
    },
    {
      key: "accessKeyId",
      label: "AccessKey ID",
      placeholder: "LTAI...",
      hint:
        "填专用 RAM 用户的 AccessKey ID。获取：RAM 访问控制 → 用户 → 认证管理 → AccessKey。",
    },
    {
      key: "accessKeySecret",
      label: "AccessKey Secret",
      placeholder: snapshot?.config.accessKeySecretConfigured
        ? "留空表示保持当前 Secret"
        : "请输入 AccessKey Secret",
      hint:
        "填与上方 ID 成对的 AccessKey Secret，只在创建 AccessKey 时显示一次；当前已配置时留空会保留原 Secret。",
    },
    {
      key: "publicBaseUrl",
      label: "Public Base URL",
      placeholder: "https://your-bucket.oss-cn-hangzhou.aliyuncs.com",
      hint:
        "仅在文件能通过公网域名直接访问时填写完整根地址，可使用 Bucket 域名、CDN 或自定义域名，末尾不要加 /。私有 Bucket 请留空，系统会使用签名 URL。",
      optional: true,
    },
  ];

  const activeRows = snapshot
    ? [
        ["Endpoint", snapshot.config.endpoint],
        ["Region", snapshot.config.region],
        ["Bucket", snapshot.config.bucket],
        ["AccessKey ID", snapshot.config.accessKeyId],
        [
          "AccessKey Secret",
          uiLabel(snapshot.config.accessKeySecretConfigured ? "已配置" : "未配置"),
        ],
        [
          "Public Base URL",
          snapshot.config.publicBaseUrl || uiLabel("未配置（使用签名 URL）"),
        ],
      ]
    : [];

  const statusLabel = loading && !snapshot
    ? "读取中"
    : snapshot?.ready
      ? "当前生效"
      : "尚未完整配置";

  return (
    <section
      id="sys-aliyun-oss"
      className="scroll-mt-28 rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]">
            <Cloud className="h-4 w-4 text-[var(--primary-bg)]" /><UiText id="admin.m4a9f06c48df2" /></h3>
          <p className="mt-2 text-[12px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m4d547bcba8c7" /></p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-600 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
          {uiLabel(statusLabel)}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mf6814fea9925" /></div>
          <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m6181ed6f9734" />{uiLabel(sourceLabel(snapshot?.source))}
            {snapshot?.updatedAt
              ? <UiText id="admin.mbd56366c6801" values={{v0: String(new Date(snapshot.updatedAt).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN"))}} />
              : ""}
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activeRows.map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3"
            >
              <div className="text-[11px] text-[var(--app-muted)]">
                {label}
              </div>
              <div className="mt-1 break-all text-[12px] text-[var(--app-fg)]">
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--app-fg)]">
          <Info className="h-4 w-4 text-[var(--primary-bg)]" /><UiText id="admin.mcefb0398283a" /></div>
        <div className="mt-3 grid gap-3 text-[12px] leading-5 text-[var(--app-muted)] md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <span className="font-medium text-[var(--app-fg)]"><UiText id="admin.mcc0c8d9c4484" /></span><UiText id="admin.ma48d486da958" /></div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <span className="font-medium text-[var(--app-fg)]"><UiText id="admin.m07761a46d113" /></span><UiText id="admin.m894259926307" /></div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.md1d0ba92315f" /></p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="block">
            <span className="text-[12px] font-medium text-[var(--app-fg)]">
              {uiLabel(field.label)}
              {field.optional ? <UiText id="admin.m3d5c3c3dbaca" /> : ""}
            </span>
            <input
              type={field.key === "accessKeySecret" ? "password" : "text"}
              value={form[field.key]}
              onChange={(event) => update(field.key, event.target.value)}
              placeholder={uiLabel(field.placeholder)}
              disabled={loading || saving || !snapshot}
              autoComplete="off"
              aria-describedby={`oss-${field.key}-hint`}
              className="mt-2 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none transition focus:border-[var(--primary-bg)] disabled:opacity-50"
            />
            <span
              id={`oss-${field.key}-hint`}
              className="mt-2 block text-[11px] leading-5 text-[var(--app-muted)]"
            >
              {uiLabel(field.hint)}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {notice ? (
            <div
              className={notice.type === "ok"
                ? "text-[12px] text-emerald-600 dark:text-emerald-300"
                : "text-[12px] text-rose-600 dark:text-rose-300"}
            >
              {notice.type === "err" ? uiError(notice.text) : uiLabel(notice.text)}
            </div>
          ) : null}
          {notice?.type === "err" && !snapshot ? (
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[12px] text-[var(--app-fg)] disabled:opacity-50"
            ><UiText id="admin.mdf7392cc96be" /></button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving || !canSave || !dirty}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary-bg)] px-4 text-[13px] text-[var(--primary-fg)] transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Save className="h-4 w-4" />}
          {saving ? <UiText id="admin.m6a6a98dea4cf" /> : <UiText id="admin.m5dbc2e1934a8" />}
        </button>
      </div>
    </section>
  );
}
