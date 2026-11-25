"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { personalLibraryOptions } from "@/components/canvas/canvas-library-cache";
import { personalMaterialUrl, personalMaterialPreviewUrl, type PersonalMaterial } from "@/lib/canvas/personal-library-types";
import AgentReferenceThumbnail from "./AgentReferenceThumbnail";
import styles from "./canvas-agent.module.css";

const kindNames = { image: "图片", video: "视频", audio: "音频" };

export default function AgentMaterialLibraryPicker({ ownerId, query, disabled, selectedIds, onSelect }: {
  ownerId: number;
  query: string;
  disabled: boolean;
  selectedIds: string[];
  onSelect: (item: PersonalMaterial) => void;
}) {
  const { data: library, isLoading, error, refetch } = useQuery({
    ...personalLibraryOptions(ownerId),
    enabled: ownerId > 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 15_000,
  });
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const folders = library?.folders ?? [];
  const items = library?.items ?? [];
  const search = query.trim().toLocaleLowerCase();
  const folderPath = (folderId: string | null) => {
    const names: string[] = [];
    const seen = new Set<string>();
    while (folderId && !seen.has(folderId)) {
      seen.add(folderId);
      const folder = folders.find((entry) => entry.id === folderId);
      if (!folder) break;
      names.unshift(folder.name);
      folderId = folder.parentId;
    }
    return names.join(" / ");
  };
  const itemRow = (item: PersonalMaterial) => (
    <button
      type="button"
      key={item.id}
      className={styles.menuItem}
      disabled={disabled || selectedIds.includes(item.id)}
      aria-label={`${item.name}，${selectedIds.includes(item.id) ? "已引用" : "引用素材"}`}
      title={`${item.name} · ${kindNames[item.kind]}${item.folderId ? ` · ${folderPath(item.folderId)}` : ""}`}
      onClick={() => onSelect(item)}
    >
      <div className={styles.mentionThumbnail}>
        <AgentReferenceThumbnail name={item.name} preview={{ kind: item.kind, url: personalMaterialUrl(item.id), thumbnailUrl: item.kind === "image" ? personalMaterialPreviewUrl(item.id, ownerId) : undefined }} />
      </div>
      <span><strong>{item.name}</strong></span>
      {selectedIds.includes(item.id) && <Check size={14} />}
    </button>
  );
  const folderTree = (parentId: string | null, ancestors: string[] = []): React.ReactNode => (
    <>
      {folders.filter((folder) => folder.parentId === parentId && !ancestors.includes(folder.id)).map((folder) => {
        const open = !collapsed.has(folder.id);
        return (
          <div key={folder.id}>
            <button type="button" className={`${styles.menuItem} ${styles.mentionFolder}`} aria-expanded={open} onClick={() => setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
              return next;
            })}>
              <div className={styles.mentionFolderIcon}>
                {open ? <FolderOpen size={14} strokeWidth={1.5} /> : <Folder size={14} strokeWidth={1.5} />}
              </div>
              <span><strong>{folder.name}</strong></span>
              <ChevronRight size={12} className={open ? "rotate-90" : ""} />
            </button>
            {open && <div>{folderTree(folder.id, [...ancestors, folder.id])}</div>}
          </div>
        );
      })}
      {items.filter((item) => item.folderId === parentId).map(itemRow)}
    </>
  );

  if (!ownerId) return <p className={styles.menuHint}><UiText id="common.m5ee6b854a5e6" /></p>;
  if (isLoading) return <p className={styles.menuHint}><UiText id="common.md1bdae05eb04" /></p>;
  if (error && !library) return <div role="alert" className={styles.menuHint}><UiText id="common.m20049f7c3387" /><button type="button" className="ml-2 underline" onClick={() => void refetch()}><UiText id="common.mb8784c8dd563" /></button></div>;
  const matches = search ? items.filter((item) => `${item.name} ${folderPath(item.folderId)}`.toLocaleLowerCase().includes(search)) : [];
  return (
    <UiProps ids={{"aria-label":["common.m1057d0fedde2"]}}><div aria-label="common.m1057d0fedde2">
      {search ? (matches.length ? matches.map(itemRow) : <p className={styles.menuHint}><UiText id="common.md7c7bbd2aa03" /></p>) : folders.length || items.length ? folderTree(null) : <p className={styles.menuHint}><UiText id="common.m5d491fcc11b5" /></p>}
    </div></UiProps>
  );
}
