"use client";
import { UiText, UiProps } from "@/i18n/ui";

export function Seedream55Result({ output: value }: { output?: unknown }) {
  if (!value || typeof value !== "object") return null;
  const output = value as { layer?: Record<string, any>; size?: string };
  if (!output.layer || typeof output.layer !== "object") return null;
  const layer = output.layer;
  const text = typeof layer.text_recognition?.text === "string" ? layer.text_recognition.text : "";
  return <details className="mt-3 whitespace-normal rounded-lg border border-[var(--border)] p-3 text-xs">
    <summary className="cursor-pointer font-medium"><UiText id="image.ma0d07f578454" /></summary>
    <div className="mt-2 space-y-2">
      <p>{typeof layer.name === "string" ? layer.name : Number(layer.z_index) === 0 ? <UiText id="image.m4e162d443d3d" /> : <UiText id="image.mbc5fda84a69e" />}{output.size ? ` · ${output.size}` : ""}</p>
      {text ? <UiProps ids={{"aria-label":["image.m44bcc4312a95"]}}><textarea aria-label="image.m44bcc4312a95" readOnly value={text} className="min-h-24 w-full rounded border border-[var(--border)] bg-[var(--input-bg)] p-2" /></UiProps> : <p className="text-[var(--app-muted)]"><UiText id="image.m624f2367705b" /></p>}
      <a className="underline" download="layer-metadata.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(output, null, 2))}`}><UiText id="image.m07927f3787c3" /></a>
    </div>
  </details>;
}
