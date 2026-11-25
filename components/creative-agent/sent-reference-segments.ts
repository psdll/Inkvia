import type { CreativeAgentReference } from "@/lib/creative-agent/contracts";
import { creativeAgentReferenceKey } from "@/lib/creative-agent/canvas-selection";

const WORD = /[A-Za-z0-9_]/;

/** Display projection only. Stored text, copy/edit and fact offsets remain untouched. */
export function sentReferenceSegments(text: string, references: CreativeAgentReference[]): { text?: string; reference?: CreativeAgentReference }[] {
  const unique = [...new Map(references.map(ref => [creativeAgentReferenceKey(ref), ref])).values()];
  const byName = new Map<string, CreativeAgentReference[]>();
  for (const ref of unique) byName.set(ref.label, [...byName.get(ref.label) ?? [], ref]);
  const names = [...byName.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  const result: { text?: string; reference?: CreativeAgentReference }[] = [], used = new Set<string>();
  let cursor = 0, plain = "";
  while (cursor < text.length) {
    // Chinese runs straight into a mention ("看下@脚本.md全局…"), so only ASCII word
    // characters need a boundary: "a@b" is an address and "@图片1" must not match "@图片12".
    const name = text[cursor] === "@" && !WORD.test(text[cursor - 1] ?? "")
      ? names.find(name => text.startsWith(name, cursor + 1) && !(WORD.test(name.at(-1) ?? "") && WORD.test(text[cursor + name.length + 1] ?? ""))) : undefined;
    const ref = name && byName.get(name)?.length === 1 ? byName.get(name)![0] : undefined;
    if (ref) {
      if (plain) { result.push({ text: plain }); plain = ""; }
      const key = creativeAgentReferenceKey(ref);
      if (!used.has(key)) { result.push({ reference: ref }); used.add(key); }
      cursor += name!.length + 1;
    } else plain += text[cursor++];
  }
  if (plain) result.push({ text: plain });
  for (const ref of unique) if (!used.has(creativeAgentReferenceKey(ref))) result.push({ reference: ref });
  return result;
}
