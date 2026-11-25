import { getGptImage25SelectionValue, resolveGptImage25Selection } from "@/lib/gpt-image-25-models";

export function resolveModelDisplayName(model: string | null | undefined, names: Record<string, string>, params?: Record<string, unknown> | null) {
  const original = model?.trim() || "";
  const selection = resolveGptImage25Selection(original);
  const key = getGptImage25SelectionValue(selection.model, selection.gptImage25Mode ?? params?.gptImage25Mode);
  return names[key]?.trim() || names[selection.model]?.trim() || original;
}
