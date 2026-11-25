import type { JSONContent } from "@tiptap/core";
import { getMiniMaxSpeechCapabilities } from "@/lib/minimax-speech-models";

export function formatSpeechPause(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0.01 || seconds > 99.99 || Math.abs(seconds * 100 - Math.round(seconds * 100)) > 1e-8) {
    throw new Error("停顿时长须为 0.01–99.99 秒，最多两位小数");
  }
  return `<#${seconds}#>`;
}

export function speechTextToDoc(text: string, model: string): JSONContent {
  const capabilities = getMiniMaxSpeechCapabilities(model);
  const interjections = new Set<string>(capabilities.interjections.map(([, token]) => token));
  return {
    type: "doc",
    content: text.replace(/\r\n?/g, "\n").split("\n").map((line) => {
      const content: JSONContent[] = [];
      let start = 0;
      for (const match of line.matchAll(/<#\d+(?:\.\d{1,2})?#>|\([a-z-]+\)/g)) {
        const token = match[0];
        const seconds = Number(token.slice(2, -2));
        if (!(interjections.has(token) || (capabilities.pause && token.startsWith("<#") && seconds >= 0.01 && seconds <= 99.99))) continue;
        if (match.index! > start) content.push({ type: "text", text: line.slice(start, match.index) });
        content.push({ type: "speechToken", attrs: { token } });
        start = match.index! + token.length;
      }
      if (start < line.length) content.push({ type: "text", text: line.slice(start) });
      return { type: "paragraph", content };
    }),
  };
}

export function speechDocToText(node: JSONContent): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "speechToken") return String(node.attrs?.token || "");
  if (node.type === "hardBreak") return "\n";
  return (node.content || []).map(speechDocToText).join(node.type === "doc" ? "\n" : "");
}
