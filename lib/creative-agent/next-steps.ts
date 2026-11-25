/**
 * 收尾里的“下一步”快捷选项：Agent 在最后一行写 <next>选项1|选项2|选项3</next>。
 * 正文里不显示这行，改成回复下方可直接点选的按钮；流式输出时写了一半的标签也先藏起来。
 */
const NEXT = /\n?[ \t]*<next>([\s\S]*?)(?:<\/next>|$)\s*$/i;

export function splitNextSteps(text: string): { body: string; steps: string[] } {
  const match = text.match(NEXT);
  if (!match) {
    const tail = text.match(/<[a-z]{0,4}$/i);
    return { body: tail && "<next>".startsWith(tail[0].toLowerCase()) ? text.slice(0, tail.index).trimEnd() : text, steps: [] };
  }
  const steps = match[1].split(/[|｜]/)
    .map(step => step.trim().replace(/^[「“"']+|[」”"']+$/g, "").trim())
    .filter(step => step && step.length <= 24)
    .slice(0, 3);
  return { body: text.slice(0, match.index).trimEnd(), steps: /<\/next>/i.test(match[0]) ? steps : [] };
}
