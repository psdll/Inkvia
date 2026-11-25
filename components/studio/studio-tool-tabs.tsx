"use client";

import { useUiLocale } from "@/i18n/ui";
import * as React from "react";
import { Image as ImageIcon, Video } from "lucide-react";
import type { StudioTool } from "@/lib/studio/visited-tools";

const TOOL_OPTIONS: Array<{
  value: StudioTool;
  label: string;
  icon: typeof ImageIcon;
}> = [
  { value: "image", label: "studio.tool_image", icon: ImageIcon },
  { value: "video", label: "studio.tool_video", icon: Video },
];

export function StudioToolTabs({
  activeTool,
  onSelectTool,
}: {
  activeTool: StudioTool;
  onSelectTool: (tool: StudioTool) => void;
}) {
  const { text } = useUiLocale();
  return (
    <div className="flex h-[64px] shrink-0 items-center border-b border-[var(--border)] p-[clamp(12px,1.8dvh,16px)]">
      <div className="mx-auto grid w-full max-w-[520px] grid-cols-2 gap-2">
        {TOOL_OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = activeTool === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => onSelectTool(value)}
              className={[
                "flex h-10 w-full items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-medium transition-[color] duration-100",
                active
                  ? "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]"
                  : "border-transparent text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--panel-2)_45%,transparent)] hover:text-[var(--app-fg)]",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {text(label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
