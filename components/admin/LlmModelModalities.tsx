"use client";

import { UiProps, useUiLocale } from "@/i18n/ui";
import { ImageIcon, Music2, Type, Video } from "lucide-react";
import { getLlmModelModalities, type LlmModality } from "@/lib/llm-routing/model-modalities";

const MODALITIES = {
  text: { label: "文本", icon: Type },
  image: { label: "图片", icon: ImageIcon },
  audio: { label: "音频", icon: Music2 },
  video: { label: "视频", icon: Video },
};

export function LlmModelModalities({ providerId, modelId }: { providerId: string; modelId: string }) {
  const { text, label: tLabel } = useUiLocale();
  const modalities = getLlmModelModalities(providerId, modelId);
  if (!modalities) return null;
  const renderGroup = (label: string, values: readonly LlmModality[]) => (
    <span className="inline-flex flex-col items-center gap-1.5 whitespace-nowrap">
      <span className="text-[var(--app-muted)]">{label}</span>
      <span className="inline-flex h-3.5 items-center justify-center gap-2">
        {values.map(value => {
          const { icon: Icon, label: name } = MODALITIES[value];
          return <span key={value} role="img" aria-label={text("providersDynamic.m8851ce28626e", { group: label, name: tLabel(name) })} title={tLabel(name)}><Icon aria-hidden="true" className="h-3.5 w-3.5" /></span>;
        })}
      </span>
    </span>
  );
  return (
    <UiProps ids={{"title":["admin.mf836e19fd8b4"]}}><span className="inline-grid shrink-0 grid-cols-[5rem_1px_4rem] items-center gap-3 text-center text-[11px] font-normal leading-tight text-[var(--app-fg)]"
      title="admin.mf836e19fd8b4"
      aria-label={text("providersDynamic.mf036607ed22f", { model: modelId })}>
      {renderGroup(text("providersDynamic.m076f4feea71e"), modalities.input)}
      <span aria-hidden="true" className="h-7 w-px bg-[var(--border)]" />
      {renderGroup(text("providersDynamic.mb63008047eee"), modalities.output)}
    </span></UiProps>
  );
}
