"use client";

import { FileText, Image as ImageIcon, Music2 } from "lucide-react";
import { MediaImage } from "@/components/ui/media-image";
import type { ReferencePreview } from "./reference-preview";

/** `compact` is the inline chip size: a text document shows its icon there, not unreadable miniature text. */
export default function AgentReferenceThumbnail({ preview, name, compact = false }: { preview?: ReferencePreview; name: string; compact?: boolean }) {
  if (preview?.thumbnailUrl || preview?.kind === "image" && preview.url) {
    return <MediaImage src={preview.thumbnailUrl || preview.url!} alt={name} className="h-full w-full object-cover" previewSize={{ width: 64, height: 64 }} />;
  }
  if (preview?.kind === "video" && preview.url) return <video src={preview.url} aria-label={name} className="h-full w-full object-cover" muted playsInline preload="metadata" />;
  if (preview?.kind === "audio") return <Music2 size={16} aria-label={name} />;
  if (preview?.kind === "text" && compact) return <FileText size={14} aria-label={name} />;
  if (preview?.kind === "text") return <span title={name} className="line-clamp-3 whitespace-pre-wrap break-all text-[6px] leading-[8px]">{preview.text || <FileText size={16} />}</span>;
  return <ImageIcon size={16} aria-label={name} />;
}
