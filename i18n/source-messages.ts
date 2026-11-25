import chinese from "@/messages/zh-CN.json";
import english from "@/messages/en.json";
import type { UiLocale } from "./locale";

type Catalog = Record<string, string>;
type SourceTemplate = {
  prefix: string;
  anchorLength: number;
  pattern: RegExp;
  render: (captures: string[]) => string;
};
const hasHan = /\p{Script=Han}/u;
const placeholder = /\{(v\d+)\}/g;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function sourceLookup(original: Catalog, translated: Catalog) {
  const exact = new Map<string, string>();
  const templates: SourceTemplate[] = [];
  for (const [id, source] of Object.entries(original)) {
    const translation = translated[id];
    if (!translation) continue;
    const holes = [...source.matchAll(placeholder)].map(match => match[1]);
    if (!holes.length) {
      exact.set(source, translation);
      continue;
    }
    const parts = source.split(placeholder).filter((_, index) => index % 2 === 0);
    if (holes.length > 4 || parts.join("").trim().length < 3) continue;
    templates.push({
      prefix: parts[0],
      anchorLength: parts.join("").length,
      pattern: new RegExp(`^${parts.map(escapeRegExp).join("(.*?)")}$`, "s"),
      render: (captures: string[]) => translation.replace(placeholder, (_, key) => captures[holes.indexOf(key)] ?? ""),
    });
  }
  templates.sort((a, b) => b.anchorLength - a.anchorLength);
  const matchTemplate = (value: string) => {
    if (value.length > 2000 || !hasHan.test(value)) return;
    for (const { prefix, pattern, render } of templates) {
      if (!value.startsWith(prefix)) continue;
      const match = pattern.exec(value);
      if (match && match[0] === value) return render(match.slice(1));
    }
  };
  return { exact, matchTemplate };
}

const labels = sourceLookup(chinese.uiLabels, english.uiLabels);
const errors = sourceLookup(chinese.errors, english.errors);

export function formatUiLabel<T extends string | null | undefined>(locale: UiLocale, source: T): T | string {
  return locale === "en" && typeof source === "string" ? labels.exact.get(source) ?? labels.matchTemplate(source) ?? source : source;
}

export function formatUiError(locale: UiLocale, value: unknown, fallback = "操作失败，请重试") {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (locale === "zh-CN") return message || fallback;
  const localize = (source: string) => errors.exact.get(source) || labels.exact.get(source)
    || errors.matchTemplate(source) || labels.matchTemplate(source) || (hasHan.test(source) ? "" : source);
  return localize(message) || localize(fallback) || "Something went wrong. Try again.";
}
