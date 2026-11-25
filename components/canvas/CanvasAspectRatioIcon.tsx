import * as React from "react";
import { getAspectRatioPreviewSize } from "@/lib/aspect-ratio-preview";

export function CanvasAspectRatioIcon({ value, compact = false }: { value: string; compact?: boolean }) {
  const previewSize = getAspectRatioPreviewSize(value, compact ? 14 : 20);
  return (
    <span className={`flex items-center justify-center ${compact ? "h-4 w-4" : "h-5 w-8"}`}>
      <span
        style={previewSize}
        className="block rounded-[3px] border border-[var(--app-muted)] bg-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
      />
    </span>
  );
}
