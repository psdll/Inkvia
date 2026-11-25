import {
  CANVAS_SCHEMA_VERSION,
  parseCanvasDocumentV2,
  type CanvasDocumentV2,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSettings,
  type CanvasViewport,
} from "@/lib/canvas/document";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type CanvasBootstrap = { title: string; revision: string; document: CanvasDocumentV2 };
type BootstrapOptions = { cached?: CanvasBootstrap; readOnly?: boolean; onPage?: (nodes: CanvasNode[], viewport: CanvasViewport) => void };

const inFlightCanvasBootstraps = new Map<number, Promise<CanvasBootstrap>>();

type BootstrapPage = {
  success: true;
  notModified?: boolean;
  title: string;
  revision: string;
  settings: CanvasSettings;
  viewport: CanvasViewport;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  nextNodeCursor: string | null;
  nextEdgeCursor: string | null;
};

export class CanvasBootstrapError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "CanvasBootstrapError";
  }
}

async function loadAttempt(canvasId: number, fetcher: FetchLike, options: BootstrapOptions = {}): Promise<{
  kind: "ok";
  title: string;
  revision: string;
  document: CanvasDocumentV2;
} | { kind: "restart" }> {
  const nodes = new Map<string, CanvasNode>();
  const edges = new Map<string, CanvasEdge>();
  let revision: string | null = null;
  let title = "";
  let settings: CanvasSettings | null = null;
  let viewport: CanvasViewport | null = null;
  let nodeCursor: string | null = null;
  let edgeCursor: string | null = null;

  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const query = new URLSearchParams({ limit: "1000" });
    if (options.readOnly) query.set("prefetch", "1");
    if (!revision && options.cached) query.set("knownRevision", options.cached.revision);
    if (revision) query.set("baseRevision", revision);
    if (nodeCursor) query.set("nodeCursor", nodeCursor);
    if (edgeCursor) query.set("edgeCursor", edgeCursor);
    const response = await fetcher(`/api/canvas/${canvasId}/bootstrap?${query.toString()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as (BootstrapPage & { code?: string; error?: string }) | null;
    if (response.status === 409 && payload?.code === "BOOTSTRAP_REVISION_CHANGED") return { kind: "restart" };
    if (!response.ok || !payload?.success) {
      throw new CanvasBootstrapError(payload?.code || "CANVAS_BOOTSTRAP_FAILED", payload?.error || "Canvas bootstrap failed", response.status);
    }
    if (payload.notModified) {
      if (!options.cached || payload.revision !== options.cached.revision) throw new CanvasBootstrapError("CANVAS_CACHE_INVALID", "Canvas cache revision mismatch", 409);
      options.onPage?.(options.cached.document.nodes, payload.viewport);
      return { kind: "ok", title: payload.title, revision: payload.revision, document: { ...options.cached.document, settings: payload.settings, viewport: payload.viewport } };
    }
    if (revision && payload.revision !== revision) return { kind: "restart" };
    revision = payload.revision;
    title = payload.title;
    settings = payload.settings;
    viewport = payload.viewport;
    options.onPage?.(payload.nodes, viewport);
    for (const node of payload.nodes) nodes.set(node.id, node);
    for (const edge of payload.edges) edges.set(edge.id, edge);
    const hasMoreNodes = payload.nextNodeCursor !== null;
    const hasMoreEdges = payload.nextEdgeCursor !== null;
    if (!hasMoreNodes && !hasMoreEdges) {
      const document = parseCanvasDocumentV2({
        schemaVersion: CANVAS_SCHEMA_VERSION,
        mode: "smart",
        nodes: [...nodes.values()],
        edges: [...edges.values()],
        viewport,
        settings,
      });
      return { kind: "ok", title, revision, document };
    }
    nodeCursor = payload.nextNodeCursor ?? payload.nodes.at(-1)?.id ?? nodeCursor;
    edgeCursor = payload.nextEdgeCursor ?? payload.edges.at(-1)?.id ?? edgeCursor;
  }
  throw new CanvasBootstrapError("CANVAS_BOOTSTRAP_PAGE_LIMIT", "Canvas bootstrap exceeded the page limit", 422);
}

async function loadCanvasBootstrapWith(
  canvasId: number,
  fetcher: FetchLike,
  options?: BootstrapOptions,
): Promise<CanvasBootstrap> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await loadAttempt(canvasId, fetcher, options);
    if (result.kind === "ok") return result;
  }
  throw new CanvasBootstrapError("CANVAS_BOOTSTRAP_UNSTABLE", "Canvas changed repeatedly while loading", 409);
}

export function loadCanvasBootstrap(
  canvasId: number,
  fetcher?: FetchLike,
  options?: BootstrapOptions,
): Promise<CanvasBootstrap> {
  if (fetcher || options) return loadCanvasBootstrapWith(canvasId, fetcher ?? globalThis.fetch.bind(globalThis), options);

  const existing = inFlightCanvasBootstraps.get(canvasId);
  if (existing) return existing;

  let request: Promise<CanvasBootstrap>;
  request = loadCanvasBootstrapWith(canvasId, globalThis.fetch.bind(globalThis))
    .finally(() => {
      if (inFlightCanvasBootstraps.get(canvasId) === request) inFlightCanvasBootstraps.delete(canvasId);
    });
  inFlightCanvasBootstraps.set(canvasId, request);
  return request;
}
