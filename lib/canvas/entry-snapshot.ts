import type { CanvasBootstrap } from "./bootstrap-client";
import { parseCanvasDocumentV2 } from "./document";

type Snapshot = { key: string; at: number; value: CanvasBootstrap };
const memory = new Map<string, Snapshot>();
let database: Promise<IDBDatabase | null> | undefined;
let epoch = 0;
const MAX_AGE = 24 * 60 * 60 * 1000;

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return database ??= new Promise(resolve => {
    const request = indexedDB.open("canvas-entry-v1", 1);
    const timer = setTimeout(() => resolve(null), 250);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots", { keyPath: "key" });
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); resolve(null); };
    request.onblocked = () => resolve(null);
  });
}

export async function readCanvasEntrySnapshot(owner: number, canvasId: number): Promise<CanvasBootstrap | undefined> {
  const key = `${owner}:${canvasId}`;
  const generation = epoch;
  let record = memory.get(key);
  if (!record) {
    const db = await openDatabase();
    if (db) record = await new Promise<Snapshot | undefined>(resolve => {
      const request = db.transaction("snapshots").objectStore("snapshots").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
  }
  if (generation !== epoch || !record || record.key !== key || Date.now() - record.at > MAX_AGE) return;
  try {
    if (!/^(0|[1-9]\d*)$/.test(record.value.revision) || typeof record.value.title !== "string") return;
    return { ...record.value, document: parseCanvasDocumentV2(structuredClone(record.value.document)) };
  } catch { return; }
}

export async function writeCanvasEntrySnapshot(owner: number, canvasId: number, value: CanvasBootstrap) {
  const generation = epoch;
  // A cache is optional. Never retain unbounded project history or huge documents.
  const serialized = JSON.stringify(value);
  if (serialized.length > 2_000_000) return;
  const key = `${owner}:${canvasId}`;
  const record = { key, at: Date.now(), value: JSON.parse(serialized) as CanvasBootstrap };
  memory.delete(key); memory.set(key, record);
  while (memory.size > 3) memory.delete(memory.keys().next().value!);
  const db = await openDatabase();
  if (!db || generation !== epoch) return;
  try {
    const store = db.transaction("snapshots", "readwrite").objectStore("snapshots");
    store.put(record);
    const request = store.getAll();
    request.onsuccess = () => {
      const records = (request.result as Snapshot[]).sort((a, b) => b.at - a.at);
      records.slice(3).forEach(item => store.delete(item.key));
    };
  } catch { /* Quota or private browsing cannot prevent opening a canvas. */ }
}

export function clearCanvasEntrySnapshots() {
  epoch++; memory.clear();
  void openDatabase().then(db => { try { db?.transaction("snapshots", "readwrite").objectStore("snapshots").clear(); } catch {} });
}
if (typeof window !== "undefined") window.addEventListener("auth:logout", clearCanvasEntrySnapshots);
