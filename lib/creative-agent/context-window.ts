/** Keep complete turns. Durable transcripts remain intact and can be searched by history_read. */
export function windowCreativeMessages(
  messages: Record<string, unknown>[],
  maxCharacters = 180_000,
  hasConversationContext = false,
) {
  const systems = messages.filter((message) => message.role === "system");
  const turns: Record<string, unknown>[][] = [];
  for (const message of messages.filter((item) => item.role !== "system")) {
    if (
      (message.role === "user" && !message.__creativeObservation) ||
      !turns.length
    )
      turns.push([]);
    turns[turns.length - 1].push(message);
  }
  let size = JSON.stringify(systems).length;
  const kept: typeof turns = [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const cost = JSON.stringify(turns[index]).length;
    if (kept.length && size + cost > maxCharacters) break;
    kept.unshift(turns[index]);
    size += cost;
  }
  const omitted = turns.length - kept.length;
  if (omitted)
    systems.push({
      role: "system",
      content: hasConversationContext ? `较早的 ${omitted} 轮未载入；本轮完整技能、当前主体与最近实际请求语境仍已提供，无需为沿用它们额外读取画布或检索历史。仅缺少其他真实历史决定时按需查证，不能推断新增数量或授权。` : `较早的 ${omitted} 轮对话未载入本轮上下文，完整原文仍已保存。先读取 project_read 获取确认约定和采用版本；涉及历史决定必须用 history_read 查询，不根据不完整历史推断已确认或授权。`,
    });
  return [...systems, ...kept.flat()].map(
    ({ __creativeObservation: _observation, ...message }) => message,
  );
}
