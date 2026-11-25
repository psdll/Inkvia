type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & Partial<Pick<KeyboardEvent, "code">>;

export function resolveCanvasShortcut(event: ShortcutEvent) {
  // macOS Option turns letters into symbols (Option+G -> "©"), so Alt combos read the physical key.
  const physicalLetter = typeof event.code === "string" && /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : null;
  const key = event.altKey && physicalLetter ? physicalLetter : event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  if (key === "g" && (command || event.altKey) && !(command && event.altKey)) {
    if (event.shiftKey) return "ungroup";
    return "group";
  }
  if (event.altKey) return !command && event.shiftKey && key === "f" ? "arrange" : null;
  if (command) {
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "+" || key === "=") return "zoomIn";
    if (event.shiftKey) return null;
    if (key === "-") return "zoomOut";
    if (key === "0") return "fit";
    if (key === "l") return "connect";
    if (key === "d") return "duplicate";
    if (key === "enter") return "generate";
    return null;
  }
  if (event.shiftKey) return null;
  if (key === "v") return "move";
  if (key === "h") return "hand";
  if (key === "tab") return "create";
  if (key === "delete" || key === "backspace") return "delete";
  return null;
}
