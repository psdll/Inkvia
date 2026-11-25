export type BackfillOptions = {
  help: boolean;
  batchSize: number;
  cursor: number;
  highWaterId: number | null;
  dryRun: boolean;
};

export function parseBackfillOptions(argv: string[]): BackfillOptions;
export function buildWorkFeedProjection(row: Record<string, any>): Record<string, any>;
export function runBackfill(options: BackfillOptions, dependencies?: Record<string, any>): Promise<Record<string, any>>;
