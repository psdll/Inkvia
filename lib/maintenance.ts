import { AsyncLocalStorage } from "node:async_hooks";
import { statSync } from "node:fs";
import { stat } from "node:fs/promises";

export const MAINTENANCE_SENTINEL_PATH = "/var/lib/inkvia-updater/state/maintenance";

export const DURABLE_TASK_MODELS = [
  "Generation",
  "UserImportJob",
  "UserExportJob",
  "CanvasRun",
  "PromptReverseTask",
  "AdminJob",
  "AgentRun",
  "CreativeAgentRun",
  "ImageBatchOutput",
] as const;

const durableTaskModels = new Set<string>(DURABLE_TASK_MODELS);
const creationOperations = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);
const completionToken = Symbol("durable-task-completion");
const generationCompletionModels = new Set<string>(["Generation"]);
const userImportRestoreModels = new Set<string>([
  "Generation",
  "AgentRun",
  "CanvasRun",
  "PromptReverseTask",
  "ImageBatchOutput",
]);

type CompletionKind = "generation" | "user-import-restore";
type CompletionContext = { token: typeof completionToken; kind: CompletionKind };
const completionContext = new AsyncLocalStorage<CompletionContext>();

type StatFile = (path: string) => Promise<unknown>;
type StatFileSync = (path: string) => unknown;

type QueryContext<Args, Result> = {
  model: string;
  operation: string;
  args: Args;
  query: (args: Args) => Promise<Result>;
};

export class MaintenanceSubmissionError extends Error {
  readonly code = "MAINTENANCE_ACTIVE";

  constructor() {
    super("New work is temporarily unavailable during maintenance");
    this.name = "MaintenanceSubmissionError";
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function completionAllows(model: string): boolean {
  const context = completionContext.getStore();
  if (context?.token !== completionToken) return false;
  return context.kind === "generation"
    ? generationCompletionModels.has(model)
    : userImportRestoreModels.has(model);
}

function runCompletionCreate<T>(kind: CompletionKind, callback: () => T): T {
  return completionContext.run({ token: completionToken, kind }, callback);
}

export function runGenerationCompletionCreate<T>(callback: () => T): T {
  return runCompletionCreate("generation", callback);
}

export function runUserImportRestoreCreate<T>(callback: () => T): T {
  return runCompletionCreate("user-import-restore", callback);
}

export function createDurableWorkAdmissionCheck(statFile: StatFile = stat) {
  return async function checkDurableWorkAdmission(): Promise<void> {
    try {
      await statFile(MAINTENANCE_SENTINEL_PATH);
    } catch (error) {
      if (isMissingFile(error)) return;
      throw new MaintenanceSubmissionError();
    }
    throw new MaintenanceSubmissionError();
  };
}

export const assertDurableWorkAdmission = createDurableWorkAdmissionCheck();

export function createBackgroundJobAdmissionCheck(
  statFile: StatFileSync = statSync,
) {
  return function backgroundJobsMayStart(): boolean {
    try {
      statFile(MAINTENANCE_SENTINEL_PATH);
      return false;
    } catch (error) {
      return isMissingFile(error);
    }
  };
}

export const backgroundJobsAllowed = createBackgroundJobAdmissionCheck();

export function createDurableTaskMaintenanceGuard(statFile: StatFile = stat) {
  return async function guardDurableTaskCreation<Args, Result>({
    model,
    operation,
    args,
    query,
  }: QueryContext<Args, Result>): Promise<Result> {
    if (durableTaskModels.has(model) && creationOperations.has(operation)) {
      if (completionAllows(model)) return query(args);
      try {
        await statFile(MAINTENANCE_SENTINEL_PATH);
      } catch (error) {
        if (isMissingFile(error)) return query(args);
        throw new MaintenanceSubmissionError();
      }
      throw new MaintenanceSubmissionError();
    }

    return query(args);
  };
}

export const durableTaskMaintenanceGuard = createDurableTaskMaintenanceGuard();
