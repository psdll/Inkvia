import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { applyCanvasOperations, type CanvasOperation } from "@/lib/canvas/operations";
import { serializedByteLength } from "@/lib/canvas/limits";

export const CANVAS_DRAFT_DATABASE_NAME = "canvas-drafts-v1";
export const CANVAS_DRAFT_MAX_BYTES = 10 * 1024 * 1024;
export const CANVAS_DRAFT_MAX_COMMANDS = 10_000;

export type CanvasDraftScope = {
  authUserId: number | string;
  canvasId: number;
  tabId: string;
};

export type CanvasDraftStatus = "pending" | "sending";

export type CanvasDraftCommand = {
  recordKey: string;
  scopeKey: string;
  protocolVersion: number;
  clientMutationId: string;
  clientSequence: number;
  baseRevision: string;
  operations: CanvasOperation[];
  inverseOperations: CanvasOperation[];
  createdAt: number;
  status: CanvasDraftStatus;
  payloadHash?: string;
};

export type CanvasDraftCommandInput = Omit<CanvasDraftCommand, "recordKey" | "scopeKey" | "status" | "payloadHash"> & {
  payloadHash?: string;
};

export interface CanvasDraftDriver {
  list(scope: CanvasDraftScope): Promise<CanvasDraftCommand[]>;
  put(command: CanvasDraftCommand): Promise<void>;
  delete(recordKey: string): Promise<void>;
}

export class CanvasDraftJournalError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CanvasDraftJournalError";
  }
}

export function draftScopeKey(scope: CanvasDraftScope): string {
  return `${encodeURIComponent(String(scope.authUserId))}:${scope.canvasId}:${encodeURIComponent(scope.tabId)}`;
}

function recordKey(scopeKey: string, mutationId: string): string {
  return `${scopeKey}:${encodeURIComponent(mutationId)}`;
}

function fingerprint(input: CanvasDraftCommandInput): string {
  return JSON.stringify({
    protocolVersion: input.protocolVersion,
    clientMutationId: input.clientMutationId,
    clientSequence: input.clientSequence,
    baseRevision: input.baseRevision,
    operations: input.operations,
    inverseOperations: input.inverseOperations,
  });
}

export function createCanvasDraftJournal(options: {
  driver: CanvasDraftDriver;
  scope: CanvasDraftScope;
  maxBytes?: number;
  maxCommands?: number;
}) {
  const { driver, scope } = options;
  const scopeKey = draftScopeKey(scope);
  const maxBytes = options.maxBytes ?? CANVAS_DRAFT_MAX_BYTES;
  const maxCommands = options.maxCommands ?? CANVAS_DRAFT_MAX_COMMANDS;
  let currentFlush: Promise<void> | null = null;

  const pending = async () => (await driver.list(scope))
    .filter((item) => item.status === "pending" || item.status === "sending")
    .sort((left, right) => left.clientSequence - right.clientSequence);

  const append = async (input: CanvasDraftCommandInput): Promise<CanvasDraftCommand> => {
    const items = await pending();
    const payloadHash = input.payloadHash || fingerprint(input);
    const existing = items.find((item) => item.clientMutationId === input.clientMutationId);
    if (existing) {
      if (existing.payloadHash === payloadHash) return existing;
      throw new CanvasDraftJournalError("DRAFT_MUTATION_ID_REUSED", `mutation ${input.clientMutationId} already has different content`);
    }
    if (items.length >= maxCommands) {
      throw new CanvasDraftJournalError("DRAFT_COMMAND_LIMIT", `draft queue exceeds ${maxCommands} commands`);
    }
    const command: CanvasDraftCommand = {
      ...input,
      recordKey: recordKey(scopeKey, input.clientMutationId),
      scopeKey,
      status: "pending",
      payloadHash,
    };
    const bytes = items.reduce((total, item) => total + serializedByteLength(item), 0) + serializedByteLength(command);
    if (bytes > maxBytes) {
      throw new CanvasDraftJournalError("DRAFT_BYTE_LIMIT", `draft queue exceeds ${maxBytes} bytes`);
    }
    await driver.put(command);
    return command;
  };

  const updateStatus = async (mutationId: string, status: CanvasDraftStatus) => {
    const item = (await pending()).find((candidate) => candidate.clientMutationId === mutationId);
    if (!item) throw new CanvasDraftJournalError("DRAFT_COMMAND_NOT_FOUND", `mutation ${mutationId} is not pending`);
    await driver.put({ ...item, status });
  };

  const markSending = (mutationId: string) => updateStatus(mutationId, "sending");
  const markPending = (mutationId: string) => updateStatus(mutationId, "pending");

  const flush = async (sender: (command: CanvasDraftCommand) => Promise<{ revision: string }>): Promise<void> => {
    if (currentFlush) return currentFlush;
    currentFlush = (async () => {
      for (const item of await pending()) {
        await driver.put({ ...item, status: "sending" });
        try {
          await sender({ ...item, status: "sending" });
          await driver.delete(item.recordKey);
        } catch (error) {
          await driver.put({ ...item, status: "pending" });
          throw error;
        }
      }
    })().finally(() => {
      currentFlush = null;
    });
    return currentFlush;
  };

  return {
    append,
    pending,
    markSending,
    markPending,
    acknowledge: async (mutationId: string) => {
      const item = (await pending()).find((candidate) => candidate.clientMutationId === mutationId);
      if (item) await driver.delete(item.recordKey);
    },
    submit: async (
      input: CanvasDraftCommandInput,
      sender: (command: CanvasDraftCommand) => Promise<{ revision: string }>,
    ) => {
      await append(input);
      await flush(sender);
    },
    flush,
    recover: async (document: CanvasDocumentV2) => {
      let recovered = document;
      for (const item of await pending()) recovered = applyCanvasOperations(recovered, item.operations);
      return recovered;
    },
  };
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

export function createIndexedDbCanvasDraftDriver(
  indexedDb: IDBFactory = globalThis.indexedDB,
): CanvasDraftDriver {
  let databasePromise: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!databasePromise) {
      databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (!indexedDb) {
          reject(new CanvasDraftJournalError("DRAFT_STORAGE_UNAVAILABLE", "IndexedDB is unavailable"));
          return;
        }
        const request = indexedDb.open(CANVAS_DRAFT_DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          const store = database.objectStoreNames.contains("commands")
            ? request.transaction!.objectStore("commands")
            : database.createObjectStore("commands", { keyPath: "recordKey" });
          if (!store.indexNames.contains("by_scope")) store.createIndex("by_scope", "scopeKey", { unique: false });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
        request.onblocked = () => reject(new CanvasDraftJournalError("DRAFT_STORAGE_BLOCKED", "IndexedDB upgrade is blocked"));
      });
    }
    return databasePromise;
  };

  return {
    async list(scope) {
      const database = await open();
      const transaction = database.transaction("commands", "readonly");
      const request = transaction.objectStore("commands").index("by_scope").getAll(draftScopeKey(scope));
      const records = await requestPromise(request) as CanvasDraftCommand[];
      await transactionPromise(transaction);
      return records.sort((left, right) => left.clientSequence - right.clientSequence);
    },
    async put(command) {
      const database = await open();
      const transaction = database.transaction("commands", "readwrite");
      transaction.objectStore("commands").put(command);
      await transactionPromise(transaction);
    },
    async delete(key) {
      const database = await open();
      const transaction = database.transaction("commands", "readwrite");
      transaction.objectStore("commands").delete(key);
      await transactionPromise(transaction);
    },
  };
}
