import type { ExchangeRate } from "./money";
import type { PriceDraft } from "./drafts";

// Multiple versions of the same model require an explicit choice, never guess.
export function batchDrafts(drafts: PriceDraft[], provider = "", catalog?: { provider: string; model: string; module: string }[]) {
  const groups = new Map<string, PriceDraft[]>();
  const unavailable: string[] = [];
  for (const draft of drafts) {
    if ((provider && draft.provider !== provider) || !draft.rows.some(r => r.price !== "")) continue;
    if (catalog && !catalog.some(m => m.provider === draft.provider && m.model === draft.model && m.module === draft.module)) {
      unavailable.push(draft.label);
      continue;
    }
    const key = `${draft.provider}|${draft.model}`;
    groups.set(key, [...(groups.get(key) || []), draft]);
  }
  const ready = [...groups.values()].filter(g => g.length === 1).map(g => g[0]);
  const conflicts = [...groups.values()].filter(g => g.length > 1).map(g => g[0].label);
  return { ready, conflicts, unavailable, rowCount: ready.reduce((n, d) => n + d.rows.filter(r => r.price !== "").length, 0) };
}

export function batchRateDrafts(rates: ExchangeRate[], provider = "", catalog?: { provider: string }[]) {
  const groups = new Map<string, ExchangeRate[]>();
  const unavailable: string[] = [];
  for (const rate of rates) {
    if (provider && rate.provider !== provider) continue;
    const key = `${rate.provider} / ${rate.currency}`;
    if (catalog && !catalog.some((model) => model.provider === rate.provider)) {
      unavailable.push(key);
      continue;
    }
    groups.set(key, [...(groups.get(key) || []), rate]);
  }
  return { ready: [...groups.values()].filter((rates) => rates.length === 1).map((rates) => rates[0]),
    conflicts: [...groups].filter(([, rates]) => rates.length > 1).map(([key]) => key), unavailable };
}
