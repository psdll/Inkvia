import type { CanvasDocumentV2, CanvasMediaIdentity } from "./document";
import { MAX_CANVAS_ARCHIVE_BYTES, MAX_CANVAS_JSON_BYTES, parseCanvasJson, validateCanvasArchiveEntries, detachWorkflowExecution } from "./transfer";
import { classifyUploadMime } from "@/lib/upload-validation";

type Resource = { url: string; kind: "image" | "video" | "audio" };
type UploadedMedia = CanvasMediaIdentity & { url: string };
type ArchiveResource = Resource & { path: string; mimeType: string };

// Bound network/decode pressure and settle in-flight operations before reporting failure.
export type WorkflowProgress = (message: string) => void;
async function transferResources<T>(items: T[], action: (item: T, index: number) => Promise<void>, concurrency = 4, sizeOf?: (item: T) => number) {
  let next = 0;
  let failed = false;
  let failure: unknown;
  let activeBytes = 0;
  const memoryBudget = 64 * 1024 * 1024;
  const waiting = new Set<() => void>();
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && next < items.length) {
      const bytes = Math.min(memoryBudget, Math.max(1, sizeOf?.(items[next]) || 1));
      if (activeBytes + bytes > memoryBudget) {
        await new Promise<void>(resolve => waiting.add(resolve));
        continue;
      }
      const index = next++;
      activeBytes += bytes;
      try { await action(items[index], index); }
      catch (error) { if (!failed) { failure = error; failed = true; } }
      finally {
        activeBytes -= bytes;
        for (const resolve of waiting) resolve();
        waiting.clear();
      }
    }
  }));
  if (failed) throw failure;
}
const extensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp",
  "image/tiff": "tiff", "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-matroska": "mkv",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/wave": "wav", "audio/vnd.wave": "wav", "audio/aac": "aac", "audio/ogg": "ogg",
  "audio/webm": "webm", "audio/flac": "flac", "audio/x-flac": "flac", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
};

function mediaType(url: string, kind: Resource["kind"], declared = "") {
  const mime = declared.toLowerCase().split(";")[0].trim();
  if (classifyUploadMime(mime) === kind) return mime;
  const ext = url.split(/[?#]/)[0].split(".").at(-1)?.toLowerCase();
  return Object.keys(extensions).find((type) => extensions[type] === ext && classifyUploadMime(type) === kind)
    || ({ image: "image/png", video: "video/mp4", audio: "audio/mpeg" }[kind]);
}

export function collectWorkflowResources(document: CanvasDocumentV2): Resource[] {
  const resources = new Map<string, Resource>();
  const add = (url: string | undefined, kind: Resource["kind"]) => {
    if (url) resources.set(url, { url, kind });
  };
  for (const { data } of document.nodes) {
    if (data.kind === "image" || data.kind === "video" || data.kind === "audio") add(data.url, data.kind);
    if (data.kind === "imageTask") {
      add(data.task.angleSource?.url, "image");
      add(data.task.pinnedSource?.url, "image");
      for (const reference of data.task.references || []) add(reference.url, "image");
      for (const batch of data.task.batches || []) for (const output of batch.outputs) add(output.url, "image");
    }
    if (data.kind === "videoTask") {
      add(data.outputUrl, "video");
      for (const url of data.mediaPaths) {
        const ext = url.split(/[?#]/)[0].split(".").at(-1)?.toLowerCase();
        const kind = ["mp4", "webm", "mov", "mkv"].includes(ext || "") ? "video"
          : ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext || "") ? "audio" : "image";
        if (!resources.has(url)) add(url, kind);
      }
    }
    if (data.kind === "audioTask") { add(data.outputUrl, "audio"); for (const track of data.audioOutputs || []) { add(track.url, "audio"); add(track.coverUrl, "image"); } }
    if (data.kind === "audio") add(data.sunoTrack?.coverUrl, "image");
    if (data.kind === "compare") { add(data.beforeUrl, "image"); add(data.afterUrl, "image"); }
  }
  return [...resources.values()];
}

// Only rewrite structured media fields; user prompt text must remain untouched.
function restoreResources(document: CanvasDocumentV2, uploaded: Map<string, UploadedMedia>): CanvasDocumentV2 {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = { ...source };
    const media = uploaded.get(String(source.url || source.outputUrl || ""));
    if (media) {
      delete result.mediaId; delete result.variants; delete result.posterUrl; delete result.localPreview;
      if (media.mediaId) result.mediaId = media.mediaId;
      if (media.variants) result.variants = media.variants;
      if (source.kind === "video" && media.variants?.poster) result.posterUrl = media.variants.poster.url;
    }
    for (const [key, entry] of Object.entries(result)) {
      if (["url", "outputUrl", "beforeUrl", "afterUrl", "coverUrl"].includes(key) && typeof entry === "string") {
        result[key] = uploaded.get(entry)?.url || entry;
      } else if (key === "mediaPaths" && Array.isArray(entry)) {
        result[key] = entry.map((url) => uploaded.get(url)?.url || url);
      } else if (key === "referenceOrder" && Array.isArray(entry)) {
        result[key] = entry.map((id) => typeof id === "string" && id.startsWith("configured:")
          ? `configured:${uploaded.get(id.slice(11))?.url || id.slice(11)}` : id);
      } else if (key !== "variants") result[key] = visit(entry);
    }
    return result;
  };
  return visit(document) as CanvasDocumentV2;
}

export async function createWorkflowArchive(document: CanvasDocumentV2, onProgress?: WorkflowProgress, options?: { signal?: AbortSignal; concurrency?: number }): Promise<Blob> {
  document = detachWorkflowExecution(document);
  const { ZipWriter, BlobWriter, BlobReader, TextReader } = await import("@zip.js/zip.js");
  const zip = new ZipWriter(new BlobWriter("application/zip"), { level: 0, useWebWorkers: false });
  const json = JSON.stringify(document, null, 2);
  parseCanvasJson(json);
  await zip.add("workflow.json", new TextReader(json));
  // Keep just the in-flight downloads, and stream each Blob into the archive in turn.
  let writing: Promise<unknown> = Promise.resolve();
  const resources: ArchiveResource[] = [];
  const entries = [{ name: "workflow.json", size: new TextEncoder().encode(json).length }];
  const collected = collectWorkflowResources(document);
  let completed = 0;
  onProgress?.(`正在读取素材 0/${collected.length}`);
  validateCanvasArchiveEntries([...entries, { name: "manifest.json", size: 0 }, ...collected.map((_, index) => ({ name: `resources/${index}`, size: 0 }))]);
  await transferResources(collected, async (resource, index) => {
    options?.signal?.throwIfAborted();
    let response: Response;
    try { response = await fetch(resource.url, options?.signal ? { signal: options.signal } : undefined); }
    catch { throw new Error(`素材读取失败，未导出：${resource.url}`); }
    if (!response.ok) throw new Error(`素材读取失败（${response.status}），未导出：${resource.url}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error(`素材为空，未导出：${resource.url}`);
    const declared = blob.type.toLowerCase().split(";")[0].trim();
    if (declared && declared !== "application/octet-stream" && !classifyUploadMime(declared)) {
      throw new Error(`素材返回了非媒体内容，未导出：${resource.url}`);
    }
    const kind = classifyUploadMime(declared) || resource.kind;
    const mimeType = mediaType(resource.url, kind, declared);
    const path = `resources/${index + 1}.${extensions[mimeType]}`;
    entries.push({ name: path, size: blob.size });
    validateCanvasArchiveEntries(entries);
    const pending = writing.then(() => zip.add(path, new BlobReader(blob)));
    writing = pending.catch(() => undefined);
    await pending;
    resources[index] = { ...resource, kind, path, mimeType };
    onProgress?.(`正在读取素材 ${++completed}/${collected.length}`);
  }, options?.concurrency ?? 6);
  options?.signal?.throwIfAborted();
  const manifest = JSON.stringify({ version: 2, resources });
  validateCanvasArchiveEntries([...entries, { name: "manifest.json", size: new TextEncoder().encode(manifest).length }]);
  await zip.add("manifest.json", new TextReader(manifest));
  // Image/video/audio files are already compressed; avoid recompressing hundreds of files.
  onProgress?.("正在打包 ZIP");
  const result = await zip.close();
  if (result.size > MAX_CANVAS_ARCHIVE_BYTES) throw new Error("ZIP 文件过大（上限 10 GB）");
  return result;
}

export async function readWorkflowFile(file: File, upload: (file: File) => Promise<UploadedMedia>, onProgress?: WorkflowProgress): Promise<CanvasDocumentV2> {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("请选择 ZIP 工作流文件");
  if (file.size > MAX_CANVAS_ARCHIVE_BYTES) throw new Error("ZIP 文件过大（上限 10 GB）");
  const { ZipReader, BlobReader, BlobWriter, TextWriter } = await import("@zip.js/zip.js");
  onProgress?.("正在读取 ZIP");
  // Read the directory first and extract only referenced entries, never the whole ZIP buffer.
  const zip = new ZipReader(new BlobReader(file), { useWebWorkers: false, checkCrc32: true });
  try {
  const entries = (await zip.getEntries()).filter(entry => !entry.directory);
  validateCanvasArchiveEntries(entries.map(entry => ({ name: entry.filename, size: entry.uncompressedSize })));
  const files = new Map(entries.map(entry => [entry.filename, entry]));
  if (files.size !== entries.length) throw new Error("归档包含重复路径");
  for (const name of ["workflow.json", "manifest.json"]) {
    if ((files.get(name)?.uncompressedSize || 0) > MAX_CANVAS_JSON_BYTES) throw new Error("工作流素材清单或 JSON 过大");
  }
  const workflow = files.get("workflow.json");
  if (!workflow) throw new Error("ZIP 缺少 workflow.json");
  const document = parseCanvasJson(await workflow.getData(new TextWriter()));
  const manifestFile = files.get("manifest.json");
  if (!manifestFile) return detachWorkflowExecution(document);
  const manifest = JSON.parse(await manifestFile.getData(new TextWriter()));
  let resources: ArchiveResource[];
  if (manifest.version === 2 && Array.isArray(manifest.resources)) {
    resources = manifest.resources;
  } else if (manifest.version === 1 && manifest.resources && typeof manifest.resources === "object") {
    resources = Object.entries(manifest.resources).map(([id, path]) => {
      const data = document.nodes.find((node) => node.id === id)?.data;
      if (!data || !(data.kind === "image" || data.kind === "video" || data.kind === "audio") || typeof path !== "string") throw new Error("工作流素材清单无效");
      return { url: data.url, kind: data.kind, path, mimeType: mediaType(data.url, data.kind) };
    });
  } else throw new Error("工作流素材清单无效");
  const known = new Set(collectWorkflowResources(document).map((resource) => resource.url));
  // Validate the whole manifest before uploading anything or changing the canvas.
  for (const resource of resources) {
    if (!resource || typeof resource.path !== "string" || !known.has(resource.url)
      || !["image", "video", "audio"].includes(resource.kind)
      || typeof resource.mimeType !== "string" || classifyUploadMime(resource.mimeType) !== resource.kind) throw new Error("工作流素材清单无效");
    validateCanvasArchiveEntries([{ name: resource.path, size: 0 }]);
    if (!files.has(resource.path)) throw new Error(`ZIP 缺少素材：${resource.path}`);
  }
  const uploaded = new Map<string, UploadedMedia>();
  const detached = detachWorkflowExecution(document);
  const retainedUrls = new Set(collectWorkflowResources(detached).map(resource => resource.url));
  const unique = [...new Map(resources.filter(resource => retainedUrls.has(resource.url)).map(resource => [resource.url, resource])).values()];
  let completed = 0;
  onProgress?.(`正在导入素材 0/${unique.length}`);
  await transferResources(unique, async resource => {
    const entry = files.get(resource.path)!;
    let blob: Blob;
    if (entry.compressionMethod === 0 && !entry.encrypted) {
      // Validate the entry/CRC in bounded chunks, then upload a slice of the original
      // file instead of allocating a second copy of every stored media file.
      await entry.getData(new WritableStream<Uint8Array>({ write() {} }));
      const offset = entry.localDirectory!.dataOffset;
      blob = file.slice(offset, offset + entry.uncompressedSize, resource.mimeType);
    } else {
      blob = await entry.getData(new BlobWriter(resource.mimeType));
    }
    const media = await upload(new File([blob], resource.path.split("/").at(-1)!, { type: resource.mimeType }));
    if (!media?.url) throw new Error("素材上传结果缺少地址");
    uploaded.set(resource.url, media);
    onProgress?.(`正在导入素材 ${++completed}/${unique.length}`);
  }, 8, resource => files.get(resource.path)!.uncompressedSize);
  return restoreResources(detached, uploaded);
  } finally {
    await zip.close();
  }
}
