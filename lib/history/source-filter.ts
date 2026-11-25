export function buildHistorySourceWhere(source: string) {
  if (!source || source === "all") return null;
  if (source === "tool") {
    return {
      AND: [
        { source: "tool" },
        { liveVideoBatchOutput: { is: null } },
      ],
    };
  }
  return { source };
}
