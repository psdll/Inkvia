import { v4 as uuidv4 } from "uuid";

/** LAN HTTP has getRandomValues, but randomUUID requires a secure context. */
export function createBrowserUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return uuidv4({ random: globalThis.crypto.getRandomValues(new Uint8Array(16)) });
}
