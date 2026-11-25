import { createPromptAssetMentionPattern, type PromptReferenceAsset } from "@/lib/prompt-asset-references";
import { CHARACTER_SHEET_PRESET_ID, CREATIVE_MENTION_NODE_NAME, creativeToken, creativeTokenPattern, stripRetiredCreativeTokens } from "@/lib/canvas/creative-presets/inline-token";

export type PromptRichEditorNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PromptRichEditorNode[];
};

export type PromptRichEditorDoc = {
  type: "doc";
  content: PromptRichEditorNode[];
};

export type PromptRoleSkillReference = {
  id: string;
  name: string;
};

export const ASSET_MENTION_NODE_NAME = "assetMention";
export const ROLE_SKILL_MENTION_NODE_NAME = "roleSkillMention";

const PROMPT_ASSET_MENTION_PATTERN = /@(?:图片|视频|音频|人像)\d+/g;

export function getPlainAtDeletionRange({
  key,
  selection,
  textBetween,
}: {
  key: string;
  selection: { empty: boolean; from: number; to: number };
  textBetween: (from: number, to: number) => string;
}) {
  if (key !== "Backspace" && key !== "Delete") return null;

  if (!selection.empty) {
    return textBetween(selection.from, selection.to) === "@"
      ? { from: selection.from, to: selection.to }
      : null;
  }

  const from = key === "Backspace" ? selection.from - 1 : selection.from;
  const to = key === "Backspace" ? selection.from : selection.from + 1;
  if (from < 0 || textBetween(from, to) !== "@") return null;
  return { from, to };
}

function cleanText(value: unknown) {
  return String(value || "");
}

export function stripPromptAssetMentions(value: string) {
  return cleanText(value).replace(PROMPT_ASSET_MENTION_PATTERN, "");
}

function usableAssets(assets: PromptReferenceAsset[]) {
  return assets.filter((asset) => cleanText(asset.token).trim() && cleanText(asset.url).trim());
}

function pushText(nodes: PromptRichEditorNode[], text: string) {
  if (!text) return;
  const previous = nodes[nodes.length - 1];
  if (previous?.type === "text") {
    previous.text = `${previous.text || ""}${text}`;
    return;
  }
  nodes.push({ type: "text", text });
}

function roleSkillNode(skill: PromptRoleSkillReference | null | undefined): PromptRichEditorNode | null {
  if (!skill?.id || !skill.name.trim()) return null;
  return {
    type: ROLE_SKILL_MENTION_NODE_NAME,
    attrs: {
      skillId: skill.id,
      name: skill.name,
    },
  };
}

function paragraphDoc(nodes: PromptRichEditorNode[], skill: PromptRoleSkillReference | null | undefined): PromptRichEditorDoc {
  const selectedSkillNode = roleSkillNode(skill);
  const content = selectedSkillNode ? [selectedSkillNode, ...nodes] : nodes;
  return {
    type: "doc",
    content: [{ type: "paragraph", content: content.length ? content : undefined }],
  };
}

export function findPromptAssetMentions(text: string, assets: PromptReferenceAsset[]) {
  const references = usableAssets(assets);
  const byToken = new Map(references.map(asset => [asset.token, asset]));
  for (const asset of references) {
    if (asset.kind !== "image" || !/^图片\d+$/.test(asset.token)) continue;
    const alias = asset.token.replace(/^图片/, "图");
    if (!byToken.has(alias)) byToken.set(alias, asset);
  }
  if (!byToken.size) return [];
  return Array.from(text.matchAll(createPromptAssetMentionPattern([...byToken.keys()])), match => ({
    from: match.index!,
    to: match.index! + match[0].length,
    asset: byToken.get(match[0].slice(1))!,
  }));
}

export function promptTextToEditorDoc(
  value: string,
  assets: PromptReferenceAsset[],
  selectedRoleSkill?: PromptRoleSkillReference | null,
  inlinePresets = false,
): PromptRichEditorDoc {
  const text = cleanText(value);
  const references = usableAssets(assets);
  const nodes: PromptRichEditorNode[] = [];

  if (!text) {
    return paragraphDoc([], selectedRoleSkill);
  }

  if (!references.length) {
    return paragraphDoc(textToPlainNodes(text, inlinePresets), selectedRoleSkill);
  }

  let lastIndex = 0;
  for (const { from, to, asset } of findPromptAssetMentions(text, references)) {
    if (from > lastIndex) {
      nodes.push(...textToPlainNodes(text.slice(lastIndex, from), inlinePresets));
    }
    nodes.push({
      type: ASSET_MENTION_NODE_NAME,
      attrs: {
        assetId: asset.id,
        token: asset.token,
        kind: asset.kind,
        url: asset.url || "",
        name: asset.name || "",
      },
    });
    lastIndex = to;
  }

  if (lastIndex < text.length) {
    nodes.push(...textToPlainNodes(text.slice(lastIndex), inlinePresets));
  }

  return paragraphDoc(nodes, selectedRoleSkill);
}

function textToPlainNodes(text: string, inlinePresets = false) {
  const nodes: PromptRichEditorNode[] = [];
  if (inlinePresets) {
    text = stripRetiredCreativeTokens(text);
    let offset = 0;
    for (const match of text.matchAll(creativeTokenPattern())) {
      nodes.push(...textToPlainNodes(text.slice(offset, match.index)));
      const characterSheet = !match[1];
      nodes.push({ type: CREATIVE_MENTION_NODE_NAME, attrs: { presetId: characterSheet ? CHARACTER_SHEET_PRESET_ID : `${match[1]}-${match[2]}`, name: characterSheet ? "角色设定图" : "" } });
      offset = match.index! + match[0].length;
    }
    nodes.push(...textToPlainNodes(text.slice(offset)));
    return nodes;
  }
  // A leftover CR would become an extra hard break when the DOM is reparsed.
  const parts = text.split(/\r\n?|\n/);
  parts.forEach((part, index) => {
    if (index > 0) nodes.push({ type: "hardBreak" });
    pushText(nodes, part);
  });
  return nodes;
}

export function editorDocToPromptText(doc: PromptRichEditorDoc | PromptRichEditorNode | null | undefined): string {
  if (!doc) return "";

  if (doc.type === "text") return doc.text || "";
  if (doc.type === "hardBreak") return "\n";
  if (doc.type === ASSET_MENTION_NODE_NAME) {
    const token = cleanText(doc.attrs?.token).trim();
    return token ? `@${token}` : "";
  }
  if (doc.type === ROLE_SKILL_MENTION_NODE_NAME) return "";
  if (doc.type === CREATIVE_MENTION_NODE_NAME) return creativeToken(String(doc.attrs?.presetId || ""));

  const content = Array.isArray(doc.content) ? doc.content : [];
  if (doc.type === "doc") {
    return content.map((node) => editorDocToPromptText(node)).join("\n");
  }
  return content.map((node) => editorDocToPromptText(node)).join("");
}

export function findMatchingPromptAsset(
  attrs: Record<string, unknown> | undefined,
  assets: PromptReferenceAsset[],
) {
  const assetId = cleanText(attrs?.assetId);
  const url = cleanText(attrs?.url);
  return assets.find((asset) => assetId && asset.id === assetId)
    || assets.find((asset) => url && cleanText(asset.url) === url)
    || null;
}

function reconcilePromptAssetNode(
  node: PromptRichEditorNode,
  assets: PromptReferenceAsset[],
): PromptRichEditorNode | null {
  if (node.type === ASSET_MENTION_NODE_NAME) {
    const asset = findMatchingPromptAsset(node.attrs, assets);
    if (!asset) return null;
    return {
      ...node,
      attrs: {
        ...node.attrs,
        assetId: asset.id,
        token: asset.token,
        kind: asset.kind,
        url: asset.url || "",
        name: asset.name || "",
      },
    };
  }

  if (!node.content) return node;
  const content = node.content.flatMap((child) => {
    const reconciled = reconcilePromptAssetNode(child, assets);
    return reconciled ? [reconciled] : [];
  });
  return {
    ...node,
    content: content.length ? content : undefined,
  };
}

export function reconcilePromptAssetMentions(
  doc: PromptRichEditorDoc,
  assets: PromptReferenceAsset[],
): PromptRichEditorDoc {
  return {
    ...doc,
    content: doc.content.flatMap((node) => {
      const reconciled = reconcilePromptAssetNode(node, assets);
      return reconciled ? [reconciled] : [];
    }),
  };
}

