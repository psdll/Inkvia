import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { resolveUploadsRootDirectory } from '@/lib/storage';
import { assertWritablePath } from '@/lib/runtime-isolation';

// Existing private-upload rules deny serving .agent-memory through uploads/thumb
// APIs. Only an opaque key enters Generation.templateData or activity records.
function recoveryPath(generationId: number, key: string) {
  if (!Number.isSafeInteger(generationId) || generationId < 1 || !new RegExp(`^${generationId}-[a-f0-9-]{36}$`).test(key)) throw new Error('Invalid output recovery identity');
  return path.join(resolveUploadsRootDirectory(), '.agent-memory', 'generation-output-recovery', key + '.json');
}
function validateSource(source: string) {
  if (source.slice(0, 5).toLowerCase() === 'data:') {
    // Inspect only the fixed header; never run a regex over provider image bytes.
    const comma = source.indexOf(',');
    if (comma < 0 || comma > 'data:image/jpeg;base64'.length) throw new Error('Invalid output recovery source');
    const header = source.slice(0, comma).toLowerCase();
    const mime = header.slice('data:image/'.length, -';base64'.length);
    if (header !== `data:image/${mime};base64` || !['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'tiff'].includes(mime)) throw new Error('Invalid output recovery source');
    let characters = 0, padding = 0;
    for (let i = comma + 1; i < source.length; i++) {
      const code = source.charCodeAt(i);
      if (code === 61 && characters > 0 && padding < 2) { padding++; continue; }
      if (padding || !(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47 || code === 13 || code === 10)) throw new Error('Invalid output recovery source');
      characters++;
    }
    if (!characters) throw new Error('Invalid output recovery source');
    return;
  }
  let url: URL;
  try { url = new URL(source); } catch { throw new Error('Invalid output recovery source'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid output recovery source');
}
export async function captureGenerationImageOutputs(generationId: number, sources: string[]): Promise<string> {
  sources.forEach(validateSource);
  const key = `${generationId}-${randomUUID()}`, target = recoveryPath(generationId, key), temporary = target + '.tmp';
  assertWritablePath(target);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify({ version: 1, generationId, sources })); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, target);
  return key;
}
export async function readGenerationImageOutputs(generationId: number, key: string): Promise<string[]> {
  const snapshot = JSON.parse(await readFile(recoveryPath(generationId, key), 'utf8'));
  if (snapshot.version !== 1 || snapshot.generationId !== generationId || !Array.isArray(snapshot.sources) || snapshot.sources.some((value: unknown) => typeof value !== 'string')) throw new Error('Invalid output recovery snapshot');
  snapshot.sources.forEach(validateSource);
  return snapshot.sources;
}
export async function removeGenerationImageOutputs(generationId: number, key: string) {
  const target = recoveryPath(generationId, key); assertWritablePath(target); await unlink(target);
}
