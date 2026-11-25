export const PRICE_BACKUP_FORMAT = "inkvia-prices-v2";
// Backups exported before the rename stay importable.
export const LEGACY_PRICE_BACKUP_FORMAT = "ai-stools-prices-v2";
export const MAX_PRICE_FILE_BYTES = 10_000_000;
export const MAX_PRICE_FILE_ENTRIES = 20_000;

export type PriceImportItem = {
  kind: "draft" | "price" | "rate";
  provider: string;
  model: string;
  label: string;
  status: "ready" | "imported" | "existing" | "skipped" | "failed";
  reason: string;
  filledRows: number;
  missingRows: number;
  sourceDate?: string;
};

export type PriceImportReport = {
  items: PriceImportItem[];
};

export type BillingWriteResult = {
  ok: true;
  revision: number;
  importReport?: PriceImportReport;
};
