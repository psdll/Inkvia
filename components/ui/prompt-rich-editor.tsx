"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import dynamic from "next/dynamic";
import { Extension, Node, mergeAttributes, type Editor, type EditorOptions, type JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { ReactNodeViewRenderer, EditorContent, NodeViewWrapper, ReactRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { exitSuggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { Fragment, Slice } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { FileText, Image as ImageIcon, Music4, Video } from "lucide-react";
import { CHARACTER_SHEET_PRESET_ID, CREATIVE_MENTION_NODE_NAME, creativeToken } from "@/lib/canvas/creative-presets/inline-token";
import { MediaImage } from "@/components/ui/media-image";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRoleSkillFavorites } from "@/hooks/use-role-skill-favorites";
import {
  RoleSkillSlashMenu,
  type RoleSkillSlashMenuHandle,
  type RoleSkillSlashMenuProps,
} from "@/components/role-skills/role-skill-slash-menu";
import { filterRoleSkillSuggestions } from "@/hooks/use-role-skill-catalog";
import { roleSkillTagClassName } from "@/components/role-skills/role-skill-tag";
import {
  ASSET_MENTION_NODE_NAME,
  ROLE_SKILL_MENTION_NODE_NAME,
  editorDocToPromptText,
  findMatchingPromptAsset,
  findPromptAssetMentions,
  getPlainAtDeletionRange,
  promptTextToEditorDoc,
  type PromptRichEditorDoc,
  type PromptRichEditorNode,
} from "@/lib/prompt-rich-editor-content";
import type { PromptReferenceAsset } from "@/lib/prompt-asset-references";
import type { RoleSkillListItem, RoleSkillMediaType } from "@/lib/role-skills/contracts";

const RoleSkillDialog = dynamic(() => import("@/components/role-skills/role-skill-dialog").then((module) => module.RoleSkillDialog), { ssr: false });

export type PromptCreativeEditorHandle = { insertPreset(preset: { id: string; name: string }): void };

type PromptRichEditorProps = {
  value: string;
  assets: PromptReferenceAsset[];
  onValueChange: (nextValue: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  autoFocus?: boolean;
  expanded?: boolean;
  variant?: "default" | "canvasGenerator";
  leadingToken?: React.ReactNode;
  disabled?: boolean;
  editorRef?: React.Ref<Editor | null>;
  suggestionsEnabled?: boolean;
  ariaLabel?: string;
  roleSkills?: RoleSkillListItem[];
  roleSkillsLoading?: boolean;
  roleSkillsError?: string | null;
  roleSkillMediaType?: RoleSkillMediaType;
  onOpenRoleSkillLibrary?: RoleSkillSlashMenuProps["onOpenLibrary"];
  onRoleSkillSelect?: (skill: RoleSkillListItem) => void;
  selectedRoleSkill?: RoleSkillListItem | null;
  onRoleSkillRemove?: () => void;
  creativeEditorRef?: React.Ref<PromptCreativeEditorHandle>;
};

type AssetSuggestionListHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

type AssetSuggestionListProps = SuggestionProps<PromptReferenceAsset, PromptReferenceAsset>;

const assetMentionSuggestionPluginKey = new PluginKey("assetMentionSuggestion");
const roleSkillSlashSuggestionPluginKey = new PluginKey("roleSkillSlashSuggestion");

function AssetIcon({ kind }: { kind: PromptReferenceAsset["kind"] }) {
  if (kind === "video") return <Video className="h-3.5 w-3.5" />;
  if (kind === "audio") return <Music4 className="h-3.5 w-3.5" />;
  if ((kind as string) === "text") return <FileText className="h-3.5 w-3.5" />;
  return <ImageIcon className="h-3.5 w-3.5" />;
}

function isThumbnailAsset(kind: PromptReferenceAsset["kind"]) {
  return kind === "image" || kind === "video";
}

function AssetThumbnail({
  asset,
  className,
  previewSize,
}: {
  asset: Pick<PromptReferenceAsset, "kind" | "url">;
  className: string;
  previewSize: { width: number; height: number };
}) {
  if (!asset.url || !isThumbnailAsset(asset.kind)) {
    return <AssetIcon kind={asset.kind} />;
  }
  if (asset.kind === "video") {
    return <video src={asset.url} className={className} muted playsInline preload="metadata" />;
  }
  return <MediaImage src={asset.url} alt="" className={className} previewSize={previewSize} />;
}

function getAssetDisplayOrder(asset: PromptReferenceAsset, fallbackIndex: number) {
  const order = Number((asset as PromptReferenceAsset & { displayOrder?: number }).displayOrder);
  return Number.isFinite(order) && order > 0 ? order : fallbackIndex + 1;
}

function assetAttrs(asset: PromptReferenceAsset) {
  return {
    assetId: asset.id,
    token: asset.token,
    kind: asset.kind,
    url: asset.url || "",
    name: asset.name || "",
  };
}

const assetTextNormalizationKey = new PluginKey("promptAssetTextNormalization");

function convertPromptAssetText(transaction: Transaction, assets: PromptReferenceAsset[], preserveActiveMention: boolean) {
  const replacements: Array<{ from: number; to: number; asset: PromptReferenceAsset }> = [];
  transaction.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    for (const match of findPromptAssetMentions(node.text, assets)) {
      const from = position + match.from;
      const to = position + match.to;
      // Wait until the user finishes the number: @图片1 may still become @图片10.
      if (preserveActiveMention && transaction.selection.empty
        && transaction.selection.from >= from && transaction.selection.from <= to) continue;
      replacements.push({ from, to, asset: match.asset });
    }
  });
  for (const { from, to, asset } of replacements.reverse()) {
    transaction.replaceWith(from, to, transaction.doc.type.schema.nodes[ASSET_MENTION_NODE_NAME].create(assetAttrs(asset)));
  }
  return transaction;
}

function getAssetLabel(attrs: Record<string, unknown>) {
  return String(attrs.token || "");
}

function deleteAdjacentInlineReference(editor: Editor, nodeName: string, direction: "backward" | "forward") {
  const { state, view } = editor;
  const { selection } = state;

  if (selection instanceof NodeSelection && selection.node.type.name === nodeName) {
    view.dispatch(state.tr.deleteSelection().scrollIntoView());
    return true;
  }

  if (!selection.empty) return false;

  const position = selection.from;
  const resolved = state.doc.resolve(position);
  const target = direction === "backward" ? resolved.nodeBefore : resolved.nodeAfter;
  if (!target || target.type.name !== nodeName) return false;

  const from = direction === "backward" ? position - target.nodeSize : position;
  const to = direction === "backward" ? position : position + target.nodeSize;
  view.dispatch(state.tr.delete(from, to).scrollIntoView());
  return true;
}

type PromptEditorView = Parameters<NonNullable<EditorOptions["editorProps"]["handleKeyDown"]>>[0];

function handlePlainAtDeletion(view: PromptEditorView, event: KeyboardEvent) {
  const { state } = view;
  const range = getPlainAtDeletionRange({
    key: event.key,
    selection: state.selection,
    textBetween: (from, to) => {
      if (from < 0 || to > state.doc.content.size) return "";
      return state.doc.textBetween(from, to, "", "");
    },
  });
  if (!range) return false;

  view.dispatch(state.tr.delete(range.from, range.to).scrollIntoView());
  return true;
}

const inlineReferenceClassName =
  "mx-0.5 inline-flex min-h-[calc(1.15em+4px)] select-none items-center rounded-md border border-[var(--border)] bg-transparent px-1 py-[2px] align-[-0.18em] text-[1em] font-medium leading-none text-[var(--app-fg)] shadow-none";

const referenceTokenMessages = {
  图片: "createDynamic.m6cfa8131d306",
  视频: "createDynamic.mbac88ed60613",
  音频: "createDynamic.m8d2ff4eb0007",
  文件: "createDynamic.mfec6539a590e",
};

function displayReferenceToken(token: string, text: ReturnType<typeof useUiLocale>["text"]) {
  const match = /^(图片|视频|音频|文件)([0-9]+)$/.exec(token);
  return match ? text(referenceTokenMessages[match[1] as keyof typeof referenceTokenMessages], { number: match[2] }) : token;
}

function AssetMentionView(props: NodeViewProps) {
  const { text } = useUiLocale();
  const attrs = props.node.attrs as Record<string, unknown>;
  const kind = String(attrs.kind || "image") as PromptReferenceAsset["kind"];
  const url = String(attrs.url || "");
  const token = getAssetLabel(attrs);

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className={[
        inlineReferenceClassName,
        "max-w-[112px] gap-0.5",
        props.selected ? "ring-1 ring-blue-400/60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-asset-mention=""
      data-asset-id={String(attrs.assetId || "")}
      title={String(attrs.name || token)}
      data-token={token}
      onMouseDown={(event: React.MouseEvent<HTMLSpanElement>) => {
        if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !props.editor.isEditable) return;
        const position = props.getPos();
        if (typeof position !== "number") return;
        // Native caret hit-testing can jump across a hard break before an atom.
        const bounds = event.currentTarget.getBoundingClientRect();
        const after = event.clientX >= bounds.left + bounds.width / 2;
        event.preventDefault();
        props.editor.commands.setTextSelection(position + (after ? props.node.nodeSize : 0));
        props.editor.view.focus();
      }}
    >
      <span className="flex h-[1.15em] w-[1.15em] shrink-0 items-center justify-center overflow-hidden rounded-[3px] !bg-transparent text-[var(--app-muted)]">
        <AssetThumbnail asset={{ kind, url }} className="h-full w-full object-cover" previewSize={{ width: 64, height: 64 }} />
      </span>
      <span className="truncate">{displayReferenceToken(token, text)}</span>
    </NodeViewWrapper>
  );
}

const AssetSuggestionList = React.forwardRef<AssetSuggestionListHandle, AssetSuggestionListProps>(function AssetSuggestionList(
  props,
  ref
) {
  const { text } = useUiLocale();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const items = props.items || [];

  React.useEffect(() => {
    setActiveIndex(0);
  }, [props.query, items.length]);

  const selectItem = React.useCallback(
    (index: number) => {
      const item = items[index];
      if (item) props.command(item);
    },
    [items, props]
  );

  React.useImperativeHandle(
    ref,
    () => ({
      onKeyDown({ event }) {
        if (!items.length) return false;
        if (event.key === "ArrowDown") {
          setActiveIndex((current) => (current + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setActiveIndex((current) => (current - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          selectItem(activeIndex);
          return true;
        }
        return false;
      },
    }),
    [activeIndex, items.length, selectItem]
  );

  if (!items.length) return null;

  return (
    <div
      data-prompt-asset-menu=""
      className="max-h-[min(calc(22.5rem+10px),calc(100dvh-24px))] w-[240px] overflow-y-auto overscroll-contain rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1 text-[var(--app-fg)] shadow-[var(--shadow-2)] dark:!bg-[var(--prompt-asset-menu-bg)]"
    >
      {items.map((asset, index) => {
        const displayName = asset.name || asset.url || asset.token;
        const displayOrder = getAssetDisplayOrder(asset, index);
        return (
          <button
            key={asset.id}
            type="button"
            onMouseEnter={() => setActiveIndex(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              selectItem(index);
            }}
            className={[
              "flex h-9 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] transition",
              index === activeIndex ? "bg-[var(--panel-2)] dark:bg-[var(--prompt-asset-menu-active-bg)]" : "hover:bg-[var(--panel-2)]",
            ].join(" ")}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--border)] bg-[var(--input-bg)] text-[var(--app-muted)]">
              <AssetThumbnail asset={asset} className="h-full w-full object-cover" previewSize={{ width: 80, height: 80 }} />
            </span>
            <span className="min-w-0 flex-1 overflow-hidden leading-tight">
              <span className="block truncate font-medium" title={displayName}>{displayName}</span>
              <span className="block truncate text-[10px] text-[var(--app-muted)]">{displayReferenceToken(asset.token, text)}</span>
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-[var(--app-muted)]">(@{displayOrder})</span>
          </button>
        );
      })}
    </div>
  );
});

function createAssetMentionExtension(getAssets: () => PromptReferenceAsset[], suggestionsEnabled = true) {
  return Node.create({
    name: ASSET_MENTION_NODE_NAME,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,

    addAttributes() {
      return {
        assetId: { default: "" },
        token: { default: "" },
        kind: { default: "image" },
        url: { default: "" },
        name: { default: "" },
      };
    },

    parseHTML() {
      return [{ tag: "span[data-asset-mention]" }];
    },

    renderHTML({ node, HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, { "data-asset-mention": "" }), `@${node.attrs.token}`];
    },

    renderText({ node }) {
      return `@${node.attrs.token || ""}`;
    },

    addNodeView() {
      return ReactNodeViewRenderer(AssetMentionView, { selectedOnTextSelection: false });
    },

    addKeyboardShortcuts() {
      return {
        Backspace: () => deleteAdjacentInlineReference(this.editor, this.name, "backward"),
        Delete: () => deleteAdjacentInlineReference(this.editor, this.name, "forward"),
      };
    },

    addProseMirrorPlugins() {
      const extensionName = this.name;
      return [
        new Plugin({
          key: assetTextNormalizationKey,
          appendTransaction: (transactions, _oldState, state) => {
            if (this.editor.view.composing || !transactions.some(tr => tr.docChanged || tr.getMeta(assetTextNormalizationKey))) return null;
            const complete = transactions.some(tr => tr.getMeta(assetTextNormalizationKey) === "complete");
            const transaction = convertPromptAssetText(state.tr, getAssets(), !complete);
            return transaction.docChanged ? transaction : null;
          },
          props: {
            attributes: state => ({
              "data-asset-caret-active": String(this.editor.isEditable && state.selection.empty
                && state.selection.$from.nodeAfter?.type.name === extensionName),
            }),
            decorations: state => {
              const anchors: Decoration[] = [];
              state.doc.descendants((node, position) => {
                if (node.type.name !== extensionName) return;
                // Give Chrome a line box before an uneditable atom, including
                // immediately after a hard break. This is view-only, never prompt text.
                anchors.push(Decoration.widget(position, () => {
                  const anchor = document.createElement("img");
                  anchor.alt = "";
                  anchor.setAttribute("aria-hidden", "true");
                  anchor.setAttribute("data-asset-caret-anchor", "");
                  anchor.className = "ProseMirror-separator";
                  anchor.style.cssText = "display:inline!important;width:0;height:1em!important;margin:0!important;border:0!important;padding:0!important";
                  return anchor;
                }, { side: -1, raw: true, key: `asset-caret-${position}` }));
                if (this.editor.isEditable && state.selection.empty && state.selection.from === position) {
                  anchors.push(Decoration.widget(position, () => {
                    const caret = document.createElement("span");
                    caret.setAttribute("aria-hidden", "true");
                    caret.setAttribute("data-asset-visible-caret", "");
                    return caret;
                  }, { side: -2, key: `asset-visible-caret-${position}` }));
                }
              });
              return DecorationSet.create(state.doc, anchors);
            },
            handleDOMEvents: {
              blur: view => {
                view.dispatch(view.state.tr.setMeta(assetTextNormalizationKey, "complete"));
                return false;
              },
              compositionend: view => {
                // Let ProseMirror finish committing the IME text before replacing it.
                setTimeout(() => {
                  if (!this.editor.isDestroyed) view.dispatch(view.state.tr.setMeta(assetTextNormalizationKey, "input"));
                }, 0);
                return false;
              },
            },
          },
        }),
        Suggestion<PromptReferenceAsset, PromptReferenceAsset>({
          editor: this.editor,
          pluginKey: assetMentionSuggestionPluginKey,
          char: "@",
          allowedPrefixes: null,
          allow: () => suggestionsEnabled,
          placement: "bottom-start",
          offset: { mainAxis: 6, crossAxis: 0 },
          items: ({ query }) => {
            const normalized = query.trim().toLowerCase();
            return getAssets()
              .map((asset, index) => ({ ...asset, displayOrder: index + 1 }))
              .filter((asset) => asset.token && asset.url)
              .filter((asset) => {
                if (!normalized) return true;
                return `${asset.token} ${asset.name || ""}`.toLowerCase().includes(normalized);
              });
          },
          command: ({ editor, range, props }) => {
            editor.chain().focus().insertContentAt(range, { type: extensionName, attrs: assetAttrs(props) }).run();
          },
          render: () => {
            let component: ReactRenderer<AssetSuggestionListHandle, AssetSuggestionListProps> | null = null;
            let unmount: (() => void) | null = null;

            return {
              onStart: (props) => {
                component = new ReactRenderer(AssetSuggestionList, {
                  props,
                  editor: props.editor,
                });
                component.element.dataset.promptAssetMenuPortal = "";
                component.element.style.zIndex = "1100";
                component.element.style.pointerEvents = "auto";
                unmount = props.mount(component.element);
              },
              onUpdate(props) {
                component?.updateProps(props);
              },
              onKeyDown(props) {
                if (props.event.key === "Escape") {
                  exitSuggestion(props.view, assetMentionSuggestionPluginKey);
                  return true;
                }
                return component?.ref?.onKeyDown(props) || false;
              },
              onExit() {
                unmount?.();
                unmount = null;
                component?.destroy();
                component = null;
              },
            };
          },
        }),
      ];
    },
  });
}

function CreativeMentionView(props: NodeViewProps) {
  const { text } = useUiLocale();
  const presetId = String(props.node.attrs.presetId);
  const kind = presetId.split("-")[0];
  const name = presetId === CHARACTER_SHEET_PRESET_ID ? text("createDynamic.mdc301e7f2304") : String(props.node.attrs.name || text("createDynamic.mf1de1e2621de"));
  const Icon = ImageIcon;
  return <NodeViewWrapper as="span" contentEditable={false} className={`${inlineReferenceClassName} gap-1`} data-motion-mention="" data-motion-id={presetId} data-creative-kind={kind}>
    <Icon className="h-[1em] w-[1em] shrink-0 text-[var(--app-accent)]" /><span>{name}</span>
  </NodeViewWrapper>;
}

function createCreativeMentionExtension() {
  return Node.create({
    name: CREATIVE_MENTION_NODE_NAME, group: "inline", inline: true, atom: true, selectable: false,
    addAttributes() { return { presetId: { default: "", parseHTML: element => element.getAttribute("data-motion-id") }, name: { default: "" } }; },
    parseHTML() { return [{ tag: "span[data-motion-mention]" }]; },
    renderHTML({ node, HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-motion-mention": "", "data-motion-id": node.attrs.presetId }), node.attrs.name || "预设"]; },
    renderText({ node }) { return creativeToken(node.attrs.presetId); },
    addNodeView() { return ReactNodeViewRenderer(CreativeMentionView, { selectedOnTextSelection: false }); },
    addKeyboardShortcuts() { return {
      Backspace: () => deleteAdjacentInlineReference(this.editor, this.name, "backward"),
      Delete: () => deleteAdjacentInlineReference(this.editor, this.name, "forward"),
    }; },
  });
}

function RoleSkillMentionView(props: NodeViewProps) {
  const attrs = props.node.attrs as Record<string, unknown>;
  const name = String(attrs.name || "");

  return (
    <UiProps ids={{"title":["common.m7f9ee5500999"]}}><NodeViewWrapper
      as="span"
      contentEditable={false}
      className={[
        roleSkillTagClassName,
        props.selected ? "ring-1 ring-blue-400/60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-role-skill-mention=""
      data-skill-id={String(attrs.skillId || "")}
      title="common.m7f9ee5500999"
    >
      <span aria-hidden="true" className="h-[1.15em] w-0 shrink-0" />
      <span className="break-words">{name}</span>
    </NodeViewWrapper></UiProps>
  );
}

function createRoleSkillMentionExtension() {
  return Node.create({
    name: ROLE_SKILL_MENTION_NODE_NAME,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,

    addAttributes() {
      return {
        skillId: { default: "" },
        name: { default: "" },
      };
    },

    parseHTML() {
      return [{ tag: "span[data-role-skill-mention]" }];
    },

    renderHTML({ node, HTMLAttributes }) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, { "data-role-skill-mention": "" }),
        String(node.attrs.name || ""),
      ];
    },

    renderText() {
      return "";
    },

    addNodeView() {
      return ReactNodeViewRenderer(RoleSkillMentionView, { selectedOnTextSelection: false });
    },

    addKeyboardShortcuts() {
      return {
        Backspace: () => deleteAdjacentInlineReference(this.editor, this.name, "backward"),
        Delete: () => deleteAdjacentInlineReference(this.editor, this.name, "forward"),
      };
    },
  });
}

function findRoleSkillMention(
  node: PromptRichEditorNode | PromptRichEditorDoc | undefined,
): PromptRichEditorNode | null {
  if (!node) return null;
  if (node.type === ROLE_SKILL_MENTION_NODE_NAME) return node;
  for (const child of node.content || []) {
    const match = findRoleSkillMention(child);
    if (match) return match;
  }
  return null;
}

function createRoleSkillSuggestionExtension({
  getCatalog,
  refreshMenuRef,
  onSelect,
  onOpenLibrary,
}: {
  getCatalog: () => { skills: RoleSkillListItem[]; favoriteSkillIds: string[]; loading: boolean; error: string | null };
  refreshMenuRef: React.MutableRefObject<(() => void) | null>;
  onSelect: (skill: RoleSkillListItem) => void;
  onOpenLibrary: RoleSkillSlashMenuProps["onOpenLibrary"];
}) {
  return Extension.create({
    name: "roleSkillSuggestion",

    addProseMirrorPlugins() {
      return [
        Suggestion<RoleSkillListItem, RoleSkillListItem>({
          editor: this.editor,
          pluginKey: roleSkillSlashSuggestionPluginKey,
          char: "/",
          allowedPrefixes: null,
          allow: ({ range, state }) =>
            range.from === 1 &&
            state.doc.resolve(range.from).parentOffset === 0,
          placement: "bottom-start",
          offset: { mainAxis: 6, crossAxis: 0 },
          items: ({ query }) => filterRoleSkillSuggestions(getCatalog().skills, query),
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            onSelect(props);
          },
          render: () => {
            let component: ReactRenderer<
              RoleSkillSlashMenuHandle,
              RoleSkillSlashMenuProps
            > | null = null;
            let unmount: (() => void) | null = null;
            let currentProps: SuggestionProps<RoleSkillListItem, RoleSkillListItem> | null = null;
            const menuProps = (
              props: SuggestionProps<RoleSkillListItem, RoleSkillListItem>,
            ): RoleSkillSlashMenuProps => {
              const { skills, favoriteSkillIds, loading, error } = getCatalog();
              return {
                ...props,
                catalog: skills,
                favoriteSkillIds,
                loading,
                error,
                onOpenLibrary: (view, skill) => {
                  props.editor.chain().deleteRange(props.range).run();
                  exitSuggestion(props.editor.view, roleSkillSlashSuggestionPluginKey);
                  onOpenLibrary(view, skill);
                },
                onDismiss: () => {
                  exitSuggestion(props.editor.view, roleSkillSlashSuggestionPluginKey);
                  props.editor.commands.focus();
                },
              };
            };
            const refreshMenu = () => {
              if (currentProps) component?.updateProps(menuProps(currentProps));
            };

            return {
              onStart: (props) => {
                currentProps = props;
                component = new ReactRenderer(RoleSkillSlashMenu, {
                  props: menuProps(props),
                  editor: props.editor,
                });
                component.element.dataset.roleSkillSlashMenuPortal = "";
                refreshMenuRef.current = refreshMenu;
                component.element.style.zIndex = "1100";
                component.element.style.pointerEvents = "auto";
                unmount = props.mount(component.element);
              },
              onUpdate(props) {
                currentProps = props;
                refreshMenu();
              },
              onKeyDown(props) {
                if (props.event.key === "Escape") {
                  exitSuggestion(props.view, roleSkillSlashSuggestionPluginKey);
                  return true;
                }
                return component?.ref?.onKeyDown(props) || false;
              },
              onExit() {
                if (refreshMenuRef.current === refreshMenu) refreshMenuRef.current = null;
                currentProps = null;
                unmount?.();
                unmount = null;
                component?.destroy();
                component = null;
              },
            };
          },
        }),
      ];
    },
  });
}

export function PromptRichEditor({
  value,
  assets,
  onValueChange,
  onKeyDown,
  placeholder,
  className = "",
  contentClassName = "",
  autoFocus = false,
  expanded = false,
  variant = "default",
  leadingToken,
  disabled = false,
  editorRef,
  suggestionsEnabled = true,
  ariaLabel,
  roleSkills = [],
  roleSkillsLoading = false,
  roleSkillsError = null,
  roleSkillMediaType = "image",
  onOpenRoleSkillLibrary,
  onRoleSkillSelect,
  selectedRoleSkill = null,
  onRoleSkillRemove,
  creativeEditorRef,
}: PromptRichEditorProps) {
  const { user, openLoginModal } = useAuth();
  const authRef = React.useRef({ user, openLoginModal });
  authRef.current = { user, openLoginModal };
  const [skillLibrary, setSkillLibrary] = React.useState<{
    view: "browse" | "create" | "detail";
    skill?: RoleSkillListItem;
  } | null>(null);
  const inlinePresets = Boolean(creativeEditorRef);
  const valueRef = React.useRef(value);
  const onValueChangeRef = React.useRef(onValueChange);
  const onRoleSkillSelectRef = React.useRef(onRoleSkillSelect);
  const onOpenRoleSkillLibraryRef = React.useRef(onOpenRoleSkillLibrary);
  onOpenRoleSkillLibraryRef.current = onOpenRoleSkillLibrary;
  const selectedRoleSkillRef = React.useRef<RoleSkillListItem | null>(selectedRoleSkill);
  const onRoleSkillRemoveRef = React.useRef(onRoleSkillRemove);
  const roleSkillSuggestionsEnabled = suggestionsEnabled && Boolean(onRoleSkillSelect);
  const authUserId = roleSkillSuggestionsEnabled && user ? String(user.id) : "";
  const { favoriteSkillIds } = useRoleSkillFavorites(authUserId);
  const assetSignature = React.useMemo(
    () => JSON.stringify(assets.map((asset) => [asset.id, asset.token, asset.kind, asset.url || "", asset.name || ""])),
    [assets]
  );
  const stableAssets = React.useMemo(() => assets, [assetSignature]);
  const assetsRef = React.useRef(stableAssets);
  const previousAssetSignatureRef = React.useRef(assetSignature);
  assetsRef.current = stableAssets;
  const roleSkillSignature = React.useMemo(
    () => JSON.stringify(roleSkills.map((skill) => [
      skill.id,
      skill.name,
      skill.summary,
      skill.category,
      skill.coverUrl,
      skill.updatedAt,
    ])),
    [roleSkills],
  );
  const stableRoleSkills = React.useMemo(() => roleSkills, [roleSkillSignature]);
  const knownRoleSkillsRef = React.useRef(new Map<string, RoleSkillListItem>());
  for (const skill of stableRoleSkills) knownRoleSkillsRef.current.set(skill.id, skill);
  if (selectedRoleSkill) knownRoleSkillsRef.current.set(selectedRoleSkill.id, selectedRoleSkill);
  const roleSkillCatalogRef = React.useRef({ skills: stableRoleSkills, favoriteSkillIds, loading: roleSkillsLoading, error: roleSkillsError });
  const roleSkillMenuRefreshRef = React.useRef<(() => void) | null>(null);
  roleSkillCatalogRef.current = { skills: stableRoleSkills, favoriteSkillIds, loading: roleSkillsLoading, error: roleSkillsError };
  const extensions = React.useMemo(
    () => {
      const nextExtensions = [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          listItem: false,
          orderedList: false,
          strike: false,
          underline: false,
        }),
        Placeholder.configure({ placeholder: placeholder || "" }),
        createAssetMentionExtension(() => assetsRef.current, suggestionsEnabled),
        createRoleSkillMentionExtension(),
      ];
      if (inlinePresets) nextExtensions.push(createCreativeMentionExtension());
      if (roleSkillSuggestionsEnabled) {
        nextExtensions.push(createRoleSkillSuggestionExtension({
          getCatalog: () => roleSkillCatalogRef.current,
          refreshMenuRef: roleSkillMenuRefreshRef,
          onSelect: (skill) => onRoleSkillSelectRef.current?.(skill),
          onOpenLibrary: (view, skill) => {
            const openLibrary = () => {
              if (onOpenRoleSkillLibraryRef.current) onOpenRoleSkillLibraryRef.current(view, skill);
              else setSkillLibrary({ view, skill });
            };
            if (!authRef.current.user) {
              authRef.current.openLoginModal(openLibrary);
            } else {
              openLibrary();
            }
          },
        }));
      }
      return nextExtensions;
    },
    [roleSkillSuggestionsEnabled, suggestionsEnabled, placeholder, inlinePresets],
  );

  React.useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  React.useEffect(() => {
    onRoleSkillSelectRef.current = onRoleSkillSelect;
  }, [onRoleSkillSelect]);

  React.useEffect(() => {
    selectedRoleSkillRef.current = selectedRoleSkill;
  }, [selectedRoleSkill]);

  React.useEffect(() => {
    onRoleSkillRemoveRef.current = onRoleSkillRemove;
  }, [onRoleSkillRemove]);

  const editorClassName = [
    "min-h-full outline-none",
    variant === "canvasGenerator" ? "px-0 py-0" : "px-3 py-2",
    contentClassName,
  ].filter(Boolean).join(" ");
  const editor = useEditor(
    {
      extensions,
      content: promptTextToEditorDoc(value, stableAssets, selectedRoleSkill, inlinePresets) as JSONContent,
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: editorClassName,
          ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        },
        handleDOMEvents: {
          keydown(view, event) {
            // ProseMirror also prevents unhandled Escape; let the panel receive it
            // once neither suggestion menu needs to consume the key.
            return event.key === "Escape"
              && !assetMentionSuggestionPluginKey.getState(view.state)?.active
              && !roleSkillSlashSuggestionPluginKey.getState(view.state)?.active;
          },
        },
        handleKeyDown(view, event) {
          // Reserve Ctrl/Cmd+Enter for page actions before StarterKit inserts a
          // hard break. Returning true prevents editing without stopping bubbling.
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
            return true;
          }
          return handlePlainAtDeletion(view, event);
        },
        handlePaste(view, event) {
          const text = event.clipboardData?.getData("text/plain");
          if (text == null) return false;
          event.preventDefault();
          const doc = promptTextToEditorDoc(text, assetsRef.current, undefined, inlinePresets);
          const paragraph = doc.content[0];
          const nodes = (paragraph.content || []).map((node) => view.state.schema.nodeFromJSON(node));
          view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)).scrollIntoView());
          return true;
        },
      },
      onUpdate({ editor }) {
        const nextDoc = editor.getJSON() as PromptRichEditorDoc;
        const nextValue = editorDocToPromptText(nextDoc);
        const skillId = String(findRoleSkillMention(nextDoc)?.attrs?.skillId || "");
        if (skillId !== (selectedRoleSkillRef.current?.id || "")) {
          const restoredSkill = knownRoleSkillsRef.current.get(skillId);
          selectedRoleSkillRef.current = restoredSkill || null;
          if (restoredSkill) onRoleSkillSelectRef.current?.(restoredSkill);
          else onRoleSkillRemoveRef.current?.();
        }
        valueRef.current = nextValue;
        onValueChangeRef.current(nextValue);
      },
    },
    [extensions]
  );

  React.useImperativeHandle(editorRef, () => editor, [editor]);

  React.useImperativeHandle(creativeEditorRef, () => ({
    insertPreset(preset) {
      if (!editor || editor.isDestroyed || !editor.isEditable) return;
      editor.chain().focus().insertContent({ type: CREATIVE_MENTION_NODE_NAME, attrs: { presetId: preset.id, name: preset.name } }).run();
    },
  }), [editor]);

  React.useEffect(() => {
    roleSkillMenuRefreshRef.current?.();
  }, [favoriteSkillIds, roleSkillsError, roleSkillsLoading, stableRoleSkills]);

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { class: editorClassName, ...(ariaLabel ? { "aria-label": ariaLabel } : {}) } } });
  }, [editor, editorClassName, ariaLabel]);

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let cancelled = false;
    // Creating React node views during a React effect would nest flushSync.
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return;
      const currentDoc = editor.getJSON() as PromptRichEditorDoc;
      const assetsChanged = previousAssetSignatureRef.current !== assetSignature;
      const externalValueChanged = valueRef.current !== value;
      previousAssetSignatureRef.current = assetSignature;

      if (assetsChanged && !externalValueChanged) {
        const transaction = editor.state.tr;
        editor.state.doc.descendants((node, position) => {
          if (node.type.name !== ASSET_MENTION_NODE_NAME) return;
          const asset = findMatchingPromptAsset(node.attrs, stableAssets);
          const mappedPosition = transaction.mapping.map(position);
          if (!asset) transaction.delete(mappedPosition, mappedPosition + node.nodeSize);
          else if (JSON.stringify(node.attrs) !== JSON.stringify(assetAttrs(asset))) {
            transaction.setNodeMarkup(mappedPosition, undefined, assetAttrs(asset));
          }
        });
        convertPromptAssetText(transaction, stableAssets, editor.isFocused);
        if (transaction.docChanged) {
          editor.view.dispatch(transaction.setMeta("addToHistory", false).setMeta("preventUpdate", true));
          const reconciledValue = editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc);
          valueRef.current = reconciledValue;
          if (reconciledValue !== value) onValueChangeRef.current(reconciledValue);
          return;
        }
      }

      valueRef.current = value;
      const current = editorDocToPromptText(currentDoc);
      const firstNode = currentDoc.content?.[0]?.content?.[0];
      const expectedSkillId = selectedRoleSkill?.id || "";
      const currentSkillId = firstNode?.type === ROLE_SKILL_MENTION_NODE_NAME
        ? String(firstNode.attrs?.skillId || "")
        : "";
      const hasUnexpectedSkill = !expectedSkillId && Boolean(findRoleSkillMention(currentDoc));
      if (current === value && currentSkillId === expectedSkillId && !hasUnexpectedSkill) return;
      editor.commands.setContent(
        promptTextToEditorDoc(value, stableAssets, selectedRoleSkill, inlinePresets) as JSONContent,
        { emitUpdate: false },
      );
    });
    return () => { cancelled = true; };
  }, [assetSignature, editor, selectedRoleSkill, stableAssets, value, inlinePresets]);

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled, false);
  }, [disabled, editor]);

  const previousExpandedRef = React.useRef(expanded);
  React.useEffect(() => {
    const moved = previousExpandedRef.current !== expanded;
    previousExpandedRef.current = expanded;
    if (!editor || editor.isDestroyed || (!autoFocus && !moved)) return;
    const frame = window.requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus(moved ? null : "end", { scrollIntoView: variant !== "canvasGenerator" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, editor, expanded, variant]);

  const handleEditorKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && editor && !editor.isDestroyed && typeof document !== "undefined"
      && document.querySelector("[data-prompt-asset-menu-portal],[data-role-skill-slash-menu-portal]")) {
      event.preventDefault();
      event.stopPropagation();
      exitSuggestion(editor.view, assetMentionSuggestionPluginKey);
      exitSuggestion(editor.view, roleSkillSlashSuggestionPluginKey);
      return;
    }
    onKeyDown?.(event);
  }, [editor, onKeyDown]);

  const handleWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (variant === "canvasGenerator"
      && event.currentTarget.scrollHeight > event.currentTarget.clientHeight + 1) {
      event.stopPropagation();
    }
  }, [variant]);

  return (
    <>
    <div
      className={[
        "prompt-rich-editor w-full min-h-0 max-h-full overflow-y-auto overscroll-contain text-[var(--app-fg)] outline-none break-words whitespace-pre-wrap cursor-text",
        variant === "canvasGenerator"
          ? "canvas-generator-prompt-viewport nowheel border-0 bg-transparent focus-within:border-transparent focus-within:ring-0"
          : "rounded-lg border border-[var(--border)] bg-[var(--input-bg)] focus-within:border-blue-500/40 focus-within:ring-1 focus-within:ring-blue-500/30",
        expanded ? "text-base leading-7" : "text-sm leading-relaxed",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onKeyDown={handleEditorKeyDown}
      onWheel={handleWheel}
      aria-disabled={disabled || undefined}
    >
      {leadingToken ? (
        <div className="flex min-h-full flex-col">
          <div className="mb-1.5 flex px-3 pt-2">{leadingToken}</div>
          <EditorContent editor={editor} className="grid min-h-0 min-w-0 flex-1 [&_.ProseMirror]:pt-0 [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0 [&_.ProseMirror_p.is-editor-empty:first-child:before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child:before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child:before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child:before]:text-[var(--app-muted)] [&_.ProseMirror_p.is-editor-empty:first-child:before]:content-[attr(data-placeholder)]" />
        </div>
      ) : (
        <EditorContent editor={editor} className="grid min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0 [&_.ProseMirror_p.is-editor-empty:first-child:before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child:before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child:before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child:before]:text-[var(--app-muted)] [&_.ProseMirror_p.is-editor-empty:first-child:before]:content-[attr(data-placeholder)]" />
      )}
    </div>
    {skillLibrary && authUserId ? (
      <RoleSkillDialog
        open
        initialView={skillLibrary.view}
        initialSkill={skillLibrary.skill}
        purpose="agent"
        authUserId={authUserId}
        mediaType={roleSkillMediaType}
        selectedRoleSkillId={selectedRoleSkill?.id || null}
        resultRoleSkillId={null}
        legacySystemPrompt=""
        result={null}
        generating={false}
        onClose={() => setSkillLibrary(null)}
        onSelect={(skill) => {
          knownRoleSkillsRef.current.set(skill.id, skill);
          onRoleSkillSelectRef.current?.(skill);
          setSkillLibrary(null);
        }}
        onGenerate={() => {}}
        onApplyResult={() => {}}
      />
    ) : null}
    </>
  );
}
