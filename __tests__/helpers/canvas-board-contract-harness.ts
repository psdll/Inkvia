// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyCanvasDocumentV2, type CanvasNode } from '@/lib/canvas/document';
import { canvasInternalNode } from './canvas-runtime-harness';
import { writeCanvasTaskPreferences } from '@/lib/canvas/task-preferences';
import { canvasNodeWorldPosition } from '@/lib/canvas/spatial-index';
import { renameCanvasNodeData } from '@/lib/canvas/material-name';
import { XYPanZoom, PanOnScrollMode } from '@xyflow/system';

const state = vi.hoisted(() => ({ runItems: [] as any[], props: null as any, editor: null as any, context: null as any, modal: null as any, library: null as any, models: null as any, submit: vi.fn(), save: vi.fn(), upload: vi.fn(), holds: vi.fn(), screenToFlow: vi.fn((point: any) => point) }));
const viewportState = vi.hoisted(() => ({ current: { x: 0, y: 0, zoom: 1 }, changed: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: (loader: () => unknown) => loader.toString().includes('ImageEditorModal') ? (props: any) => { state.modal = props; return null; } : () => null }));
vi.mock('@/components/canvas/CanvasSaveToLibraryDialog', () => ({ CanvasSaveToLibraryDialog: (props: any) => { state.library = props; return null; } }));
vi.mock('@/lib/canvas/media-upload-client', () => ({ uploadCanvasMedia: state.upload }));
vi.mock('@/components/canvas/use-canvas-models', () => ({ useCanvasModels: () => state.models, resolveCanvasModelId: (_models: unknown, id: string) => id }));
vi.mock('@/lib/client/inflight-json', () => ({ fetchJsonOnce: async () => ({ ok: true, json: { success: true, items: state.runItems } }) }));
vi.mock('@/components/canvas/CanvasViewportChrome', () => ({ CanvasViewportChrome: (props: any) => React.createElement('div', null,
  React.createElement('button', { 'aria-label': props.edgesHidden ? '显示节点连线' : '隐藏节点连线', onClick: props.onToggleEdges }),
  React.createElement('button', { 'aria-label': '网格吸附', 'aria-pressed': props.snapToGrid, onClick: props.onToggleSnap })),
}));
vi.mock('@/components/canvas/CanvasAudioPlayback', () => ({ CanvasAudioPlaybackProvider: ({ children }: any) => children }));
vi.mock('@/components/canvas/CanvasMediaPrefetch', () => ({ CanvasMediaPrefetch: () => null }));
vi.mock('@/components/canvas/CanvasNodeCard', async () => {
  const React = await import('react'); state.context = React.createContext(null);
  return { CanvasNodeCard: () => null, CanvasNodeEditorContext: state.context };
});
vi.mock('@/components/canvas/run-node', () => ({
  CANVAS_GENERATION_FOREGROUND_WAIT_MS: 1000, shouldResumeCanvasGeneration: () => false,
  submitImageGen: state.submit, submitVideoGen: state.submit, submitAudioGen: state.submit,
  waitForGenerationResult: async () => '/uploads/p2-output.png',
  waitForGenerationOutputs: async () => [{ url: '/uploads/p2-output.png' }],
}));
vi.mock('@xyflow/react', async original => {
  const actual = await original<typeof import('@xyflow/react')>(); const React = await import('react');
  const flow = {
    getViewport: () => viewportState.current, getZoom: () => viewportState.current.zoom,
    setViewport: vi.fn(async () => true), fitView: vi.fn(),
    screenToFlowPosition: state.screenToFlow, flowToScreenPosition: (point: any) => point,
    getNodes: () => state.props.nodes, getNode: (id: string) => state.props.nodes.find((node: any) => node.id === id),
    getInternalNode: (id: string) => canvasInternalNode(state.props?.nodes, id), getNodesBounds: actual.getNodesBounds,
  };
  const store = { getState: () => ({ transform: [0, 0, 1], width: 1920, height: 855 }), setState: vi.fn() };
  return { ...actual, useReactFlow: () => flow,
    useStore: (selector: any) => selector({ transform: [0, 0, 1] }),
    useStoreApi: () => store,
    ReactFlowProvider: ({ children }: any) => children,
    ReactFlow: (props: any) => { state.props = props; state.editor = React.useContext(state.context); return React.createElement('div', null, props.children); },
    Panel: ({ children }: any) => children, ViewportPortal: ({ children }: any) => children,
  };
});
import SmartCanvasBoard from '@/components/canvas/SmartCanvasBoard';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Vitest's global window proxy is not accepted as jsdom's UIEvent.view.
  const NativeMouseEvent = MouseEvent;
  vi.stubGlobal('MouseEvent', class extends NativeMouseEvent {
    constructor(type: string, init: MouseEventInit = {}) { super(type, { ...init, view: undefined }); }
  });
  state.screenToFlow.mockReset().mockImplementation((point: any) => point);
  state.runItems = []; state.props = null; state.submit.mockReset().mockResolvedValue({ generationId: 123 }); state.save.mockReset().mockResolvedValue('10');
  state.modal = null; state.models = null; state.holds.mockReset(); state.upload.mockReset();
  viewportState.current = { x: 0, y: 0, zoom: 1 }; viewportState.changed.mockReset();
  window.localStorage.removeItem('canvas_snap_to_grid_v1_guest');
  for (const key of Object.keys(window.localStorage)) if (key.startsWith('canvas_edges_hidden_')) window.localStorage.removeItem(key);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function mount(nodes: CanvasNode[] = [], edges: any[] = [], canvasId = 57, preferenceOwnerId: "guest" | number = "guest") {
  await act(async () => root.render(null));
  await act(async () => root.render(React.createElement(SmartCanvasBoard, {
    canvasId, editorSessionId: 'p2', preferenceOwnerId, onChange: viewportState.changed, onBeforeServerRun: state.save, onUndoMediaRefsChange: state.holds,
    initial: { ...createEmptyCanvasDocumentV2(), nodes, edges },
  })));
}
const imageTask = (model = 'gpt-image-2-apimart', count = 0): CanvasNode => ({
  id: 'task', type: 'imageTask', position: { x: 0, y: 0 }, data: { kind: 'imageTask', task: {
    references: Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `reference ${i}`, url: `/uploads/r${i}.png` })),
    settings: { model, prompt: 'compose', aspectRatio: '1:1', resolution: '2K', quality: 'medium', count: 1 }, batches: [],
  } },
});
export const verifyGroupConnection = async (memberCount: number, blank: boolean, textTarget = false) => {
  const members: CanvasNode[] = Array.from({ length: memberCount }, (_, i) => ({ id: `member-${i}`, parentId: 'group', type: 'image', position: { x: 20, y: 30 + i * 100 }, width: 100, height: 80, data: { kind: 'image', url: `/${i}.png` } }));
  const task: CanvasNode = textTarget ? { id: 'task', type: 'llm', position: { x: 700, y: 100 }, data: { kind: 'llm', prompt: '', status: 'idle' } } : imageTask();
  await mount([{ id: 'group', type: 'group', position: { x: 100, y: 100 }, width: 200, height: 400, data: { kind: 'group', title: 'Group', collapsed: false } }, ...members, task]);
  expect(host.querySelector('[data-canvas-multi-selection-connector]')).toBeNull();
  await act(async () => state.props.onNodesChange([{ id: 'group', type: 'select', selected: true }]));
  const connector = host.querySelector('[data-canvas-multi-selection-connector] [data-canvas-connection-handle-hit-area]');
  expect(Boolean(connector)).toBe(memberCount > 0);
  expect(host.querySelector('[data-canvas-multi-selection-frame]')).toBeNull();
  if (!connector) return;
  const target = document.createElement('div');
  if (blank) target.className = 'react-flow__pane';
  else target.dataset.canvasConnectionTargetId = 'task';
  host.append(target);
  const descriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] });
  try {
    await act(async () => connector.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, clientY: 300 })));
    expect(state.props.className).toContain('canvas-connecting');
    expect(host.querySelectorAll('[data-canvas-multi-selection-preview-line]')).toHaveLength(memberCount);
    await act(async () => window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 700, clientY: 100 })));
    expect(state.props.className).not.toContain('canvas-connecting');
    if (blank) {
      expect(host.querySelector('[data-canvas-connection-menu]')).not.toBeNull();
      expect(host.querySelector('[data-canvas-multi-selection-connector]')).toBeNull();
    } else {
      expect(state.props.edges.map((edge: any) => [edge.source, edge.target])).toEqual(members.map(node => [node.id, 'task']));
      if (textTarget) {
        expect(state.editor.isTaskPanelVisible('task')).toBe(true);
        expect(state.props.nodes.find((node: CanvasNode) => node.id === 'task').data).toMatchObject({ prompt: '', status: 'idle' });
        expect(state.submit).not.toHaveBeenCalled();
      }
    }
  } finally {
    if (descriptor) Object.defineProperty(document, 'elementsFromPoint', descriptor);
    else delete (document as any).elementsFromPoint;
  }
};

export const verifyTextIncomingConnection = async () => {
  await mount([
    { id: 'image', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', url: '/image.png' } },
    { id: 'text', type: 'llm', position: { x: 500, y: 0 }, data: { kind: 'llm', prompt: '', status: 'idle' } },
  ]);
  await act(async () => state.props.onConnect({ source: 'image', target: 'text', sourceHandle: null, targetHandle: null }));
  expect(state.props.edges).toHaveLength(1);
  expect(state.editor.isTaskPanelVisible('text')).toBe(true);
  expect(state.props.nodes.find((node: CanvasNode) => node.id === 'text').data).toMatchObject({ prompt: '', status: 'idle' });
  expect(state.submit).not.toHaveBeenCalled();
  for (const selected of [false, true, false]) {
    await act(async () => state.props.onNodesChange([{ id: 'text', type: 'select', selected }]));
    const text = state.props.nodes.find((node: CanvasNode) => node.id === 'text');
    expect(text.measured).toEqual({ width: 350, height: 350 });
    expect(text.handles.find((handle: any) => handle.id === 'canvas-task-input').y).toBe(175);
  }
};

export const verifyIndependentImageResults = async (live: boolean) => {
  const task = imageTask();
  if (task.data.kind !== 'imageTask') throw new Error('Expected image task');
  task.data.task.settings.count = 2;
  const target: CanvasNode = { id: 'target', type: 'videoTask', position: { x: 1200, y: 100 }, data: { kind: 'videoTask', model: 'video', prompt: '', mediaPaths: [], status: 'idle' } };
  if (!live) task.data.task.batches = [{ id: 'batch', createdAt: 1, settings: task.data.task.settings, outputs: [0, 1].map(i => ({ id: `output-${i}`, status: 'success', url: `/result-${i}.png` })) }];
  await mount([task, target]);
  if (live) await act(async () => state.editor.runNode('task'));
  expect(state.props.nodes.some((node: CanvasNode) => node.type === 'group')).toBe(false);
  const resultTask = state.props.nodes.find((node: CanvasNode) => node.id === 'task');
  if (!resultTask || resultTask.data.kind !== 'imageTask') throw new Error('Expected image task result');
  expect(resultTask.data.task.batches.at(-1)?.outputs).toHaveLength(2);
  expect(state.props.isValidConnection({ source: resultTask.id, target: 'target' })).toBe(true);
  await act(async () => state.props.onConnect({ source: resultTask.id, target: 'target', sourceHandle: null, targetHandle: null }));
  expect(state.props.edges.map((edge: any) => edge.source)).toEqual([resultTask.id]);
};

export const verifySnapRelease = async (reason: 'release' | 'blur' | 'pointercancel' | 'Escape' | 'hidden') => {
  await mount([
    { id: 'a', type: 'image', position: { x: 0, y: 30 }, width: 100, height: 80, data: { kind: 'image', url: '/a.png' } },
    { id: 'target', type: 'image', position: { x: 300, y: 400 }, width: 100, height: 80, data: { kind: 'image', url: '/b.png' } },
  ]);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON() {} });
  await act(async () => state.props.onNodeDragStart({ button: 0 }, state.props.nodes[0]));
  await act(async () => state.props.onNodesChange([{ id: 'a', type: 'position', position: { x: 196, y: 30 }, dragging: true }]));
  await act(async () => vi.advanceTimersByTime(30));
  expect(state.props.nodes[0].position.x).toBe(200);
  expect(host.querySelector('.canvas-alignment-guide')).not.toBeNull();
  await act(async () => {
    if (reason === 'release') state.props.onNodeDragStop();
    else if (reason === 'Escape') host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (reason === 'hidden') { vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); }
    else window.dispatchEvent(new Event(reason));
  });
  // The drag library can deliver its cached, unsnapped final coordinates after cleanup.
  await act(async () => state.props.onNodesChange([{ id: 'a', type: 'position', position: { x: 196, y: 30 }, dragging: false }]));
  await act(async () => vi.advanceTimersByTime(200));
  expect(state.props.nodes[0].position.x).toBe(200);
  expect(state.props.nodes.some((n: any) => n.dragging)).toBe(false);
  expect(host.querySelector('.canvas-alignment-guide')).toBeNull();
  // Ordinary position updates outside a drag must still be applied.
  await act(async () => state.props.onNodesChange([{ id: 'a', type: 'position', position: { x: 320, y: 30 } }]));
  expect(state.props.nodes[0].position.x).toBe(320);
};

export const verifyCrossGroupAlignment = async (multiple: boolean) => {
  const group = (id: string, x: number): CanvasNode => ({ id, type: 'group', position: { x, y: 0 }, width: 500, height: 500, data: { kind: 'group', title: id, collapsed: false } });
  const nodes: CanvasNode[] = [group('g1', 1000), group('g2', 1250),
    { id: 'a', type: 'image', parentId: 'g1', position: { x: 0, y: 30 }, width: 100, height: 80, data: { kind: 'image', url: '/a.png' } },
    { id: 'b', type: 'image', parentId: 'g2', position: { x: 0, y: 30 }, width: 100, height: 80, data: { kind: 'image', url: '/b.png' } },
    { id: 'target', type: 'image', position: { x: multiple ? 1550 : 1300, y: 700 }, width: 100, height: 80, data: { kind: 'image', url: '/target.png' } },
  ];
  await mount(nodes);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 3000, bottom: 1600, width: 3000, height: 1600, toJSON() {} });
  const ids = multiple ? ['a', 'b'] : ['a'];
  await act(async () => state.props.onNodesChange(ids.map(id => ({ type: 'select', id, selected: true }))));
  await act(async () => state.props.onNodeDragStart({ button: 0 }, state.props.nodes.find((n: any) => n.id === 'a')));
  const changes = ids.map(id => {
    const node = state.props.nodes.find((n: any) => n.id === id);
    return { type: 'position', id, position: { x: node.position.x + 196, y: node.position.y }, dragging: true };
  });
  await act(async () => state.props.onNodesChange(changes));
  await act(async () => vi.advanceTimersByTime(30));
  const byId = new Map<string, CanvasNode>(state.props.nodes.map((n: CanvasNode) => [n.id, n]));
  expect(canvasNodeWorldPosition(byId.get('a')!, byId).x).toBe(1200);
  if (multiple) expect(canvasNodeWorldPosition(byId.get('b')!, byId).x).toBe(1450);
  expect(host.querySelector('.canvas-alignment-guide')).not.toBeNull();
};

export const verifyMultiNodeAlignment = async (zoom: number) => {
  const image = (id: string, x: number, y: number): CanvasNode => ({ id, type: 'image', position: { x, y }, width: 100, height: 80, data: { kind: 'image', url: `/${id}.png` } });
  await mount([image('a', 0, 30), image('b', 150, 30), image('target', 450, 400)]);
  viewportState.current = { x: 0, y: 0, zoom };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 2000, bottom: 1600, width: 2000, height: 1600, toJSON() {} });
  await act(async () => state.props.onNodesChange([{ type: 'select', id: 'a', selected: true }, { type: 'select', id: 'b', selected: true }]));
  await act(async () => state.props.onNodeDragStart({ button: 0 }, state.props.nodes[0]));
  await act(async () => state.props.onNodesChange([
    { id: 'a', type: 'position', position: { x: 200 - 4 / zoom, y: 30 }, dragging: true },
    { id: 'b', type: 'position', position: { x: 350 - 4 / zoom, y: 30 }, dragging: true },
  ]));
  await act(async () => vi.advanceTimersByTime(30));
  expect(state.props.nodes.find((n: any) => n.id === 'a').position.x).toBe(200);
  expect(state.props.nodes.find((n: any) => n.id === 'b').position.x).toBe(350);
  expect(host.querySelector('.canvas-alignment-guide')).not.toBeNull();
  await act(async () => state.props.onNodeDragStop());
  expect(host.querySelector('.canvas-alignment-guide')).toBeNull();
};

export const verifyLegacyEdgeVisibility = async () => {
  window.localStorage.setItem('canvas_edges_hidden_v1_guest', 'true');
  await mount();
  expect(host.querySelector('[aria-label="显示节点连线"]')).not.toBeNull();
  expect(window.localStorage.getItem('canvas_edges_hidden_v2_guest_57')).toBe('true');
  // An old tab using the legacy key cannot overwrite an already migrated canvas.
  window.localStorage.setItem('canvas_edges_hidden_v1_guest', 'false');
  await mount();
  expect(host.querySelector('[aria-label="显示节点连线"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="显示节点连线"]')!.click());
  window.localStorage.setItem('canvas_edges_hidden_v1_guest', 'true');
  await mount();
  expect(host.querySelector('[aria-label="隐藏节点连线"]')).not.toBeNull();
};

export const verifyIsolatedEdgeVisibility = async () => {
  const nodes: CanvasNode[] = [
    { id: 'source', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', url: '/a.png' } },
    { id: 'target', type: 'image', position: { x: 300, y: 0 }, data: { kind: 'image', url: '/b.png' } },
  ];
  const edges = [{ id: 'edge', source: 'source', target: 'target' }];
  await mount(nodes, edges, 57);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="隐藏节点连线"]')!.click());
  expect(state.props.edges).toEqual([]);
  await mount(nodes, edges, 58);
  // The second canvas can be visible without changing the first canvas's preference.
  if (!state.props.edges.length) await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="显示节点连线"]')!.click());
  expect(state.props.edges).toHaveLength(1);
  await mount(nodes, edges, 57);
  expect(state.props.edges).toEqual([]);
  await act(async () => { window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  expect(state.props.edges).toEqual([]);
  // Server reconciliation remounts the editor with updated nodes/edges.
  await mount(nodes.map(n => ({ ...n, data: { ...n.data, name: 'updated' } })), [...edges, { ...edges[0], id: 'new-edge' }], 57);
  expect(state.props.edges).toEqual([]);
  await mount(nodes, edges, 57, 28);
  expect(state.props.edges).toHaveLength(1);
  await mount(nodes, edges, 57);
  expect(state.props.edges).toEqual([]);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="显示节点连线"]')!.click());
  expect(state.props.edges).toHaveLength(1);
};

export const verifyCanvasViewToggles = async () => {
  const nodes: CanvasNode[] = [
    { id: 'moving', type: 'image', position: { x: 0, y: 30 }, width: 100, height: 80, data: { kind: 'image', url: '/a.png' } },
    { id: 'target', type: 'image', position: { x: 300, y: 400 }, width: 100, height: 80, data: { kind: 'image', url: '/b.png' } },
  ];
  const edges = [{ id: 'edge', source: 'moving', target: 'target' }];
  await mount(nodes, edges);
  expect(host.querySelector('[aria-label="网格吸附"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(state.props.snapToGrid).toBe(false);
  expect(state.props.snapGrid).toBeUndefined();
  const initialEdges = state.props.edges;
  viewportState.changed.mockClear();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="隐藏节点连线"]')!.click());
  expect(state.props.edges).toEqual([]);
  expect(state.props.nodes.map((n: any) => n.id)).toEqual(['moving', 'target']);
  expect(viewportState.changed).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="显示节点连线"]')!.click());
  expect(state.props.edges).toBe(initialEdges);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON() {} });
  await act(async () => state.props.onNodeDragStart({ button: 0 }, state.props.nodes[0]));
  await act(async () => state.props.onNodesChange([{ id: 'moving', type: 'position', position: { x: 196, y: 30 }, dragging: true }]));
  await act(async () => vi.advanceTimersByTime(30));
  expect(state.props.nodes.find((n: any) => n.id === 'moving').position.x).toBe(200);
  expect(host.querySelector('.canvas-alignment-guide')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="网格吸附"]')!.click());
  expect(state.props.snapToGrid).toBe(false);
  expect(host.querySelector('.canvas-alignment-guide')).toBeNull();
  expect(window.localStorage.getItem('canvas_snap_to_grid_v1_guest')).toBe('false');
  await act(async () => state.props.onNodesChange([{ id: 'moving', type: 'position', position: { x: 196, y: 30 }, dragging: true }]));
  expect(state.props.nodes.find((n: any) => n.id === 'moving').position.x).toBe(196);
  await act(async () => state.props.onNodeDragStop());
  await mount(nodes, edges);
  expect(state.props.snapToGrid).toBe(false);
  expect(state.props.edges).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="隐藏节点连线"]')!.click());
  expect(window.localStorage.getItem('canvas_edges_hidden_v2_guest_57')).toBe('true');
  await mount(nodes, edges);
  expect(state.props.edges).toEqual([]);
  expect(host.querySelector('[aria-label="显示节点连线"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="显示节点连线"]')!.click());
  expect(window.localStorage.getItem('canvas_edges_hidden_v2_guest_57')).toBe('false');
  await mount(nodes, edges);
  expect(state.props.edges).toHaveLength(1);
  window.localStorage.removeItem('canvas_snap_to_grid_v1_guest');
};

export const verifyVideoFrameOutput = async (kind: 'video' | 'videoTask', mode: 'current' | 'first' | 'last', outcome: 'success' | 'failure' | 'source-changed') => {
  const sourceUrl = '/uploads/source.mp4';
  await mount([{ id: 'source', type: kind, position: { x: 0, y: 0 }, data: kind === 'video'
    ? { kind, url: sourceUrl, name: '原视频' }
    : { kind, model: '', prompt: '', mediaPaths: [], status: 'success', outputUrl: sourceUrl } }]);
  state.upload.mockReset().mockResolvedValue({ url: '/uploads/frame.png', mediaId: 'frame-media', variants: { original: { url: '/uploads/frame.png', mimeType: 'image/png' } } });
  const frame = { file: new File(['pixels'], 'frame.png', { type: 'image/png' }), time: 2.271,
    width: mode === 'current' ? 1440 : mode === 'first' ? 2560 : 1024,
    height: mode === 'current' ? 2560 : mode === 'first' ? 1440 : 1024 };
  if (outcome === 'failure') state.upload.mockRejectedValueOnce(new Error('upload failed'));
  let finish!: (payload: unknown) => void;
  if (outcome === 'source-changed') state.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  if (outcome === 'failure') {
    await act(async () => { await expect(state.editor.exportVideoFrame('source', frame, mode, sourceUrl)).rejects.toThrow('upload failed'); });
  } else if (outcome === 'source-changed') {
    let request!: Promise<void>;
    act(() => { request = state.editor.exportVideoFrame('source', frame, mode, sourceUrl); });
    await act(async () => state.editor.updateData('source', (data: any) => ({ ...data, outputUrl: '/replacement.mp4' })));
    await act(async () => { finish({ url: '/uploads/frame.png' }); await request; });
  } else {
    await act(async () => state.editor.exportVideoFrame('source', frame, mode, sourceUrl));
    const result = state.props.nodes.find((node: CanvasNode) => node.id !== 'source');
    expect(result.data).toMatchObject({ kind: 'image', url: '/uploads/frame.png', mediaId: 'frame-media', name: mode === 'current' ? '截图 00:02.271' : mode === 'first' ? '首帧' : '尾帧', variants: { original: { width: frame.width, height: frame.height } } });
    expect(result.width / result.height).toBeCloseTo(frame.width / frame.height, 2);
    expect(state.props.edges).toContainEqual(expect.objectContaining({ source: 'source', target: result.id }));
    expect(state.upload).toHaveBeenLastCalledWith(frame.file);
  }
  if (outcome !== 'success') expect(state.props.nodes).toHaveLength(1);
};
export const verifyOutpaint = async (outcome: 'success' | 'late-success' | 'late-failure') => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:p2-outpaint');
    static revokeObjectURL = vi.fn();
  });
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  state.upload.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  await mount([{ id: 'source', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', url: '/uploads/source.png' } }]);
  await act(async () => state.editor.openImageEditor('source', 'outpaint'));
  expect(state.modal).not.toBeNull();
  await act(async () => state.modal.onResult([], 'outpaint', new File(['image'], 'outpaint.png', { type: 'image/png' }), { width: 800, height: 400 }));
  expect(state.props.nodes).toHaveLength(3);
  const task = state.props.nodes.find((node: any) => node.data.kind === 'imageTask');
  const image = state.props.nodes.find((node: any) => node.data.url === 'blob:p2-outpaint');
  expect(task.data.task.settings.prompt).toBe(''); expect(task.data.task.batches).toEqual([]);
  expect(state.props.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: image.id, target: task.id })]));
  expect(state.submit).not.toHaveBeenCalled();
  if (outcome !== 'success') {
    await act(async () => root.render(null)); state.holds.mockClear();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p2-outpaint');
    const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    await act(async () => outcome === 'late-success' ? resolve({ url: '/uploads/outpaint.png' }) : reject(new Error('upload rejected')));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(state.holds).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(revoked);
  } else {
    await act(async () => resolve({ url: '/uploads/outpaint.png' }));
    expect(state.props.nodes.find((node: any) => node.id === image.id).data.url).toBe('/uploads/outpaint.png');
    expect(state.props.nodes.find((node: any) => node.id === task.id).data.task.references[0].url).toBe('/uploads/outpaint.png');
    expect(state.submit).not.toHaveBeenCalled();
  }
};
export const verifyConnectionPath = async () => {
  // This assertion checks SVG attributes and feedback timing, not browser geometry.
  const descriptor = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getTotalLength');
  Object.defineProperty(SVGElement.prototype, 'getTotalLength', { configurable: true, value: () => 0 });
  try {
  await mount(); const Line = state.props.connectionLineComponent;
  const props = { fromX: 0, fromY: 0, toX: 200, toY: 100, fromPosition: 'right', toPosition: 'left', pointer: { x: 200, y: 100 }, toNode: { id: 'target', data: { kind: 'image' } } };
  await act(async () => root.render(React.createElement('svg', null, React.createElement(Line, { ...props, connectionStatus: 'valid' }))));
  const line = host.querySelector('.canvas-connection-preview-base')!;
  expect(line.getAttribute('stroke')).toBe('var(--canvas-edge-related)');
  expect(line.getAttribute('stroke-width')).toBe('2');
  expect((line as SVGElement).style.filter).toBe('');
  expect(host.querySelector('path[stroke-width="6"]')).toBeNull();
  await act(async () => root.render(React.createElement('svg', null, React.createElement(Line, { ...props, connectionStatus: 'invalid' }))));
  expect(host.querySelector('.canvas-connection-preview-base')?.getAttribute('stroke')).toBe('var(--canvas-edge-preview)');
  await act(async () => vi.advanceTimersByTime(600)); expect(host.textContent).toContain('不能连接');
  } finally {
    if (descriptor) Object.defineProperty(SVGElement.prototype, 'getTotalLength', descriptor);
    else Reflect.deleteProperty(SVGElement.prototype, 'getTotalLength');
  }
};

export const verifyMarqueePanel = async () => {
  await mount([imageTask()]); const task = state.props.nodes[0];
  await act(async () => state.props.onNodeClick({}, task));
  await act(async () => vi.advanceTimersByTime(300));
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(true);
  await act(async () => state.props.onSelectionStart({ clientX: 0, clientY: 0 }));
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(false);
  await act(async () => state.props.onSelectionEnd({ clientX: 100, clientY: 100 }));
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(false);
  await act(async () => state.props.onNodeClick({}, task));
  await act(async () => vi.advanceTimersByTime(300));
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(true);
};

export const verifyTaskClickFocus = async (kind: string, initiallyOpen = false) => {
  await mount([imageTask()]);
  const task = { ...state.props.nodes[0], data: { ...state.props.nodes[0].data, kind } };
  if (initiallyOpen) {
    await act(async () => state.props.onNodeClick({ detail: 1 }, task));
    expect(state.editor.isTaskPanelVisible(task.id)).toBe(true);
  }
  await act(async () => state.props.onNodeClick({ detail: 1 }, task));
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(true);
  await act(async () => {
    window.dispatchEvent(new Event('pointerdown'));
    state.props.onNodeClick({ detail: 2 }, task);
    state.props.onNodeDoubleClick({ target: host, preventDefault() {}, stopPropagation() {} }, task);
  });
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(false);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(false);
  expect(state.props.nodes.find((node: CanvasNode) => node.id === task.id).selected).toBe(true);
  expect(state.submit).not.toHaveBeenCalled();
  // A subsequent standalone click still opens the editor.
  await act(async () => state.props.onNodeClick({ detail: 1 }, task));
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(true);
};

export const verifyImmediateTaskClick = async (kind: string) => {
  await mount([imageTask()]);
  const task = { ...state.props.nodes[0], data: { ...state.props.nodes[0].data, kind } };
  await act(async () => state.props.onNodeClick({ detail: 1 }, task));
  // Fake timers have not advanced: opening must happen in the click's React commit.
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(true);
  await act(async () => state.props.onNodeClick({ ctrlKey: true }, task));
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(false);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(false);
  expect(state.submit).not.toHaveBeenCalled();
};

export const verifyReferenceLimit = async (model: string) => {
    await mount([imageTask(model, 17)]);
    await act(async () => { expect(await state.editor.runNode('task')).toBe(false); });
    expect(state.save).not.toHaveBeenCalled(); expect(state.submit).not.toHaveBeenCalled();
    expect(JSON.stringify(state.props.nodes)).toContain('最多支持 16 张参考图');
    await act(async () => state.editor.updateData('task', (data: any) => ({ ...data, task: { ...data.task, references: data.task.references.slice(0, 16) } })));
    await act(async () => { expect(await state.editor.runNode('task')).toBe(true); });
    expect(state.save).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledOnce();
    expect(state.submit.mock.calls[0][0].imagePaths).toEqual(Array.from({ length: 16 }, (_, i) => `/uploads/r${i}.png`));
  };
export const verifyContextCreation = async (kind: string) => {
    await mount();
    await act(async () => state.props.onPaneContextMenu({ preventDefault() {}, clientX: 120, clientY: 240 }));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-canvas-open-create]')!.click());
    const button = host.querySelector<HTMLButtonElement>(`[data-canvas-create-kind="${kind}"]`)!;
    expect(button).not.toBeNull(); await act(async () => button.click());
    expect(state.props.nodes).toHaveLength(1); expect(state.props.nodes[0].data.kind).toBe(kind);
    expect(state.props.nodes[0].position).toEqual({ x: 120, y: 240 });
    expect(state.submit).not.toHaveBeenCalled();
  };
export const verifyCreateMenuResources = async () => {
  await mount();
  const open = async () => act(async () => host.querySelector<HTMLButtonElement>('[aria-label="添加节点"]')!.click());
  await open();
  const menu = host.querySelector('[data-canvas-context-menu]')!;
  expect(menu.textContent).toContain('添加节点');
  expect(menu.textContent).toContain('添加资源');
  expect(menu.querySelector('[data-canvas-create-kind="compare"]')).not.toBeNull();
  expect(menu.querySelectorAll('[data-canvas-create-kind]')).toHaveLength(5);
  const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  await act(async () => menu.querySelector<HTMLButtonElement>('[data-canvas-upload]')!.click());
  expect(inputClick).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-canvas-context-menu]')).toBeNull();
  await open();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-canvas-open-history]')!.click());
  expect(host.querySelector('[data-canvas-context-menu]')).toBeNull();
  expect(host.querySelector('[aria-label="生成历史"]')?.getAttribute('aria-pressed')).toBe('true');
};
export const verifyDragMerge = async () => {
    const node: CanvasNode = { id: 'image', type: 'image', position: { x: 0, y: 0 }, width: 200, height: 300, data: { kind: 'image', url: '/uploads/a.png' } };
    await mount([node]);
    // This contract checks concurrent data merging independently of grid snapping.
    const snap = host.querySelector<HTMLButtonElement>('[aria-label="网格吸附"]')!;
    if (snap.getAttribute("aria-pressed") === "true") await act(async () => snap.click());
    await act(async () => state.props.onNodeDragStart({}, state.props.nodes[0]));
    await act(async () => state.props.onNodesChange([{ type: 'position', id: node.id, position: { x: 300, y: 250 }, dragging: true }]));
    await act(async () => state.editor.updateData(node.id, (data: any) => ({ ...data, name: 'renamed' })));
    expect(state.props.nodes[0].position).toEqual({ x: 300, y: 250 });
    expect(state.props.nodes[0].data.name).toBe('renamed');
    await act(async () => state.props.onNodeDragStop({}, state.props.nodes[0]));
    expect(state.props.nodes[0].position).toEqual({ x: 300, y: 250 });
  };
export const verifyDragHandlerStability = async () => {
  const node: CanvasNode = { id: 'dragged', type: 'image', position: { x: 0, y: 0 }, width: 200, height: 300, data: { kind: 'image', url: '/uploads/a.png' } };
  await mount([node, { ...node, id: 'stationary', position: { x: 500, y: 0 } }]);
  const snap = host.querySelector<HTMLButtonElement>('[aria-label="网格吸附"]')!;
  if (snap.getAttribute('aria-pressed') === 'true') await act(async () => snap.click());
  await act(async () => state.props.onNodeDragStart({}, state.props.nodes[0]));
  const handlers = Object.fromEntries(['onNodeClick', 'onNodeDoubleClick', 'onNodeContextMenu', 'onEdgeClick'].map(key => [key, state.props[key]]));
  const stationary = state.props.nodes[1];
  for (const x of [20, 40, 60]) {
    await act(async () => state.props.onNodesChange([{ type: 'position', id: node.id, position: { x, y: 10 }, dragging: true }]));
    expect(state.props.nodes[0].position).toEqual({ x, y: 10 });
    expect(state.props.nodes[1]).toBe(stationary);
    for (const [key, handler] of Object.entries(handlers)) expect(state.props[key], key).toBe(handler);
  }
  await act(async () => state.props.onNodeDragStop({}, state.props.nodes[0]));
};
export const verifyIsolatedSingleDrag = async () => {
  const node: CanvasNode = { id: 'dragged', type: 'image', position: { x: 0, y: 0 }, width: 200, height: 300, data: { kind: 'image', url: '/uploads/a.png' } };
  await mount([node, { ...node, id: 'stationary', position: { x: 500, y: 0 } }]);
  const snap = host.querySelector<HTMLButtonElement>('[aria-label="网格吸附"]')!;
  if (snap.getAttribute('aria-pressed') === 'true') await act(async () => snap.click());
  await act(async () => state.props.onNodeDragStart({}, state.props.nodes[0]));
  // The child element tree gets a new identity whenever the editor body renders.
  const editorRenderMarker = state.props.children;
  const stationary = state.props.nodes[1];
  for (let x = 1; x <= 60; x++) {
    await act(async () => state.props.onNodesChange([{ type: 'position', id: node.id, position: { x, y: 10 }, dragging: true }]));
    expect(state.props.nodes[0].position).toEqual({ x, y: 10 });
    expect(state.props.nodes[1]).toBe(stationary);
    expect(state.props.children).toBe(editorRenderMarker);
  }
  await act(async () => window.dispatchEvent(new Event('blur')));
  expect(state.props.nodes[0].position).toEqual({ x: 60, y: 10 });
  expect(Boolean(state.props.nodes[0].dragging)).toBe(false);
};
export const verifyPanIgnoresStaleEnd = async () => {
  await mount();
  const oldStart = new MouseEvent('mousedown', { button: 0, buttons: 1 });
  const oldEnd = new MouseEvent('mouseup', { button: 0, buttons: 0 });
  const newStart = new MouseEvent('mousedown', { button: 0, buttons: 1 });
  Object.defineProperty(oldStart, 'timeStamp', { value: 10 });
  Object.defineProperty(oldEnd, 'timeStamp', { value: 20 });
  Object.defineProperty(newStart, 'timeStamp', { value: 30 });
  await act(async () => state.props.onMoveStart(oldStart));
  await act(async () => window.dispatchEvent(oldEnd));
  await act(async () => state.props.onMoveStart(newStart));
  const unrelatedCancel = new MouseEvent('pointercancel');
  Object.defineProperty(unrelatedCancel, 'pointerType', { value: 'touch' });
  await act(async () => window.dispatchEvent(unrelatedCancel));
  expect(state.props.className).toContain('canvas-interacting');
  const renderMarker = state.props.onInit;
  await act(async () => state.props.onMoveEnd(oldEnd, { x: 100, y: 0, zoom: 1 }));
  expect(state.props.className).toContain('canvas-interacting');
  expect(state.props.onInit).toBe(renderMarker);
  const newEnd = new MouseEvent('mouseup', { button: 0, buttons: 0 });
  Object.defineProperty(newEnd, 'timeStamp', { value: 40 });
  await act(async () => window.dispatchEvent(newEnd));
  await act(async () => state.props.onMoveEnd(newEnd, { x: 200, y: 0, zoom: 1 }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(state.props.className).not.toContain('canvas-interacting');
  expect(viewportState.changed.mock.lastCall?.[0].viewport.x).toBe(200);
  await act(async () => state.props.onMoveEnd(oldEnd, { x: 100, y: 0, zoom: 1 }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(viewportState.changed.mock.lastCall?.[0].viewport.x).toBe(200);
};
export const verifyIdleWheelRecovery = async (zoom: number) => {
  const source: CanvasNode = { id: 'source', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', url: '/a.png' } };
  await mount([source, { ...source, id: 'target', position: { x: 500, y: 0 } }], [{ id: 'edge', source: 'source', target: 'target' }]);
  const surface = document.createElement('div'); host.append(surface);
  const pan = XYPanZoom({ domNode: surface, minZoom: .1, maxZoom: 8, viewport: { x: 0, y: 0, zoom },
    translateExtent: [[-Infinity, -Infinity], [Infinity, Infinity]], onDraggingChange: vi.fn(),
    onPanZoomStart: event => state.props.onMoveStart(event),
    onPanZoom: (event, viewport) => state.props.onMove?.(event, viewport),
    onPanZoomEnd: (event, viewport) => state.props.onMoveEnd(event, viewport) });
  pan.update({ noWheelClassName: 'nowheel', noPanClassName: 'nopan', preventScrolling: true, panOnScroll: true,
    panOnDrag: [1], panOnScrollMode: PanOnScrollMode.Free, panOnScrollSpeed: 1, userSelectionActive: false,
    zoomOnPinch: true, zoomOnScroll: false, zoomOnDoubleClick: false, zoomActivationKeyPressed: false,
    lib: 'react', onTransformChange: ([x, y, zoom]) => { viewportState.current = { x, y, zoom }; },
    connectionInProgress: false, paneClickDistance: 5 });
  try {
    // A single wheel tick has no matching engine end callback in system 0.0.77.
    await act(async () => surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 60 })));
    expect(state.props.className).toContain('canvas-interacting');
    await act(async () => vi.advanceTimersByTime(250));
    expect(state.props.className).not.toContain('canvas-interacting');
    await act(async () => vi.advanceTimersByTime(59_750));
    expect(state.props.className).not.toContain('canvas-interacting');
    await act(async () => state.props.onNodesChange([{ id: 'source', type: 'select', selected: true }]));
    await act(async () => host.querySelector('[data-canvas-tool-mode]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
    await act(async () => state.props.onNodeClick({}, state.props.nodes[0]));
    expect(state.props.edges[0].animated).toBe(true);
    expect(viewportState.changed.mock.lastCall?.[0].viewport).toEqual(pan.getViewport());
    // The engine may resume with onMove rather than a second onMoveStart.
    await act(async () => surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 60 })));
    expect(state.props.className).toContain('canvas-interacting');
    // The relation stays active; the flow layer only pauses drawing while the camera moves.
    expect(state.props.edges[0].animated).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(state.props.className).not.toContain('canvas-interacting');
    expect(state.props.edges[0].animated).toBe(true);
  } finally { pan.destroy(); surface.remove(); }
};
export const verifyWheelRecoveryLifecycle = async (scenario: string) => {
  await mount();
  const wheel = new WheelEvent('wheel', { deltaY: 60 });
  await act(async () => state.props.onMoveStart(wheel, viewportState.current));
  await act(async () => vi.advanceTimersByTime(100));
  if (scenario === 'continuous') {
    const next = new WheelEvent('wheel', { deltaY: 60 });
    Object.defineProperty(next, 'timeStamp', { value: wheel.timeStamp + 100 });
    viewportState.current = { x: 0, y: -120, zoom: 1 };
    await act(async () => state.props.onMove(next, viewportState.current));
    await act(async () => state.props.onMoveEnd(wheel, { x: 0, y: -60, zoom: 1 }));
    await act(async () => vi.advanceTimersByTime(199));
    expect(state.props.className).toContain('canvas-interacting');
    await act(async () => vi.advanceTimersByTime(1));
    expect(state.props.className).not.toContain('canvas-interacting');
    await act(async () => vi.advanceTimersByTime(300));
    expect(viewportState.changed.mock.lastCall?.[0].viewport).toEqual(viewportState.current);
    return;
  }
  if (scenario === 'mouse pan' || scenario === 'programmatic zoom') {
    await act(async () => state.props.onMoveStart(scenario === 'mouse pan'
      ? new MouseEvent('mousedown', { button: 1, buttons: 4 }) : null, viewportState.current));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(state.props.className).toContain('canvas-interacting');
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(state.props.className).not.toContain('canvas-interacting');
    return;
  }
  if (scenario === 'unmount') {
    await act(async () => root.render(null));
    viewportState.changed.mockClear();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(viewportState.changed).not.toHaveBeenCalled();
    return;
  }
  await act(async () => {
    if (scenario === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
    } else if (scenario === 'Escape') host.querySelector('[data-canvas-tool-mode]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else window.dispatchEvent(new Event(scenario));
  });
  expect(state.props.className).not.toContain('canvas-interacting');
  // The old wheel's timer must not end a new non-wheel viewport animation.
  await act(async () => state.props.onMoveStart(null, viewportState.current));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(state.props.className).toContain('canvas-interacting');
};
export const verifyConnectionMenuDismissedOnDrag = async (multiple: boolean) => {
  const nodes: CanvasNode[] = ['a', 'b'].map((id, i) => ({ id, type: 'image', position: { x: i * 300, y: 0 }, width: 200, height: 200, data: { kind: 'image', url: `/${id}.png` } }));
  await mount(nodes);
  const pane = document.createElement('div'); pane.className = 'react-flow__pane'; host.append(pane);
  if (multiple) {
    await act(async () => state.props.onNodesChange(nodes.map(n => ({ id: n.id, type: 'select', selected: true }))));
    const hitTestDescriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [pane] });
    try {
      const connector = host.querySelector('[data-canvas-multi-selection-connector] [data-canvas-connection-handle-hit-area]')!;
      expect(connector).not.toBeNull();
      await act(async () => connector.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500, clientY: 100 })));
      await act(async () => window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 700, clientY: 100 })));
    } finally {
      if (hitTestDescriptor) Object.defineProperty(document, 'elementsFromPoint', hitTestDescriptor);
      else delete (document as any).elementsFromPoint;
    }
  } else {
    await act(async () => state.props.onConnectStart({}, { nodeId: 'a', handleType: 'source' }));
    await act(async () => state.props.onConnectEnd({ target: pane, clientX: 700, clientY: 100 }, { isValid: false, from: { x: 200, y: 100 } }));
  }
  expect(host.querySelector('[data-canvas-connection-menu]')).not.toBeNull();
  expect(host.querySelector('[data-canvas-connection-menu-line]')).not.toBeNull();
  const moving = multiple ? state.props.nodes : [state.props.nodes[0]];
  await act(async () => multiple
    ? state.props.onSelectionDragStart({ nativeEvent: {} }, moving)
    : state.props.onNodeDragStart({}, moving[0]));
  expect(host.querySelector('[data-canvas-connection-menu]')).toBeNull();
  expect(host.querySelector('[data-canvas-connection-menu-line]')).toBeNull();
  await act(async () => state.props.onNodesChange(moving.map((n: any) => ({ id: n.id, type: 'position', position: { x: n.position.x + 40, y: 60 }, dragging: true }))));
  await act(async () => multiple
    ? state.props.onSelectionDragStop({ nativeEvent: {} }, moving)
    : state.props.onNodeDragStop({}, moving[0]));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.querySelector('[data-canvas-connection-menu]')).toBeNull();
  expect(host.querySelector('[data-canvas-connection-menu-line]')).toBeNull();
  expect(state.props.nodes).toHaveLength(2);
  expect(state.props.edges).toHaveLength(0);
  expect(state.submit).not.toHaveBeenCalled();
};
export const verifyRelatedEdgeGlow = async () => {
  const source: CanvasNode = { id: 'source', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', url: '/a.png' } };
  const targets = Array.from({ length: 65 }, (_, i) => ({ ...source, id: `target-${i}`, position: { x: 500, y: i * 200 } }));
  await mount([source, ...targets], targets.map(target => ({ id: `edge-${target.id}`, source: source.id, target: target.id, type: 'default' })));
  await act(async () => state.props.onNodesChange([{ id: source.id, type: 'select', selected: true }]));
  expect(state.props.edges).toHaveLength(65);
  expect(state.props.edges.every((edge: any) => !edge.animated)).toBe(true);
  const click = async (id: string) => {
    await act(async () => host.querySelector('[data-canvas-tool-mode]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
    await act(async () => state.props.onNodeClick({}, state.props.nodes.find((n: any) => n.id === id)));
  };
  await click(source.id);
  expect(state.props.edges.every((edge: any) => edge.animated && edge.style.stroke === 'var(--canvas-edge)')).toBe(true);
  // Gestures only pause drawing (the flow layer hides while moving);
  // the relations keep flowing on release without another click.
  for (const gesture of ['pan', 'zoom', 'single', 'multi']) {
    if (gesture === 'pan' || gesture === 'zoom') {
      await act(async () => state.props.onMoveStart(null));
      expect(state.props.edges.every((edge: any) => edge.animated)).toBe(true);
      await act(async () => state.props.onMoveEnd(null, { x: 100, y: 100, zoom: gesture === 'zoom' ? .4 : 1 }));
    } else {
      const nodes = state.props.nodes.slice(0, gesture === 'multi' ? 2 : 1);
      await act(async () => gesture === 'multi' ? state.props.onSelectionDragStart({ nativeEvent: {} }, nodes) : state.props.onNodeDragStart({}, nodes[0]));
      expect(state.props.edges.every((edge: any) => edge.animated)).toBe(true);
      await act(async () => gesture === 'multi' ? state.props.onSelectionDragStop({ nativeEvent: {} }, nodes) : state.props.onNodeDragStop({}, nodes[0]));
    }
    await act(async () => vi.advanceTimersByTime(1000));
    expect(state.props.edges.every((edge: any) => edge.animated)).toBe(true);
    expect(state.props.nodes.find((n: any) => n.id === source.id).selected).toBe(true);
    expect(state.props.edges.every((edge: any) => edge.className.includes('canvas-edge-live'))).toBe(true);
  }
  await act(async () => state.props.onNodesChange([
    { id: source.id, type: 'select', selected: false },
    { id: 'target-0', type: 'select', selected: true },
  ]));
  expect(state.props.edges.every((edge: any) => !edge.animated)).toBe(true);
  await click('target-0');
  expect(state.props.edges.filter((edge: any) => edge.animated).map((edge: any) => edge.id)).toEqual(['edge-target-0']);
  await act(async () => state.props.onPaneClick());
  expect(state.props.edges.every((edge: any) => !edge.animated)).toBe(true);
  await act(async () => state.props.onEdgesChange([{ id: 'edge-target-0', type: 'select', selected: true }]));
  expect(state.props.edges.every((edge: any) => !edge.animated)).toBe(true);
};
export const verifyUndoViewportPersistence = async () => {
  const node: CanvasNode = { id: 'image', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', url: '/uploads/a.png' } };
  await mount([node]);
  await act(async () => state.editor.updateData(node.id, (data: any) => ({ ...data, name: 'renamed' })));
  viewportState.current = { x: 164, y: 391, zoom: 0.1 };
  await act(async () => state.props.onMoveEnd(null, viewportState.current));
  const canvas = host.querySelector<HTMLElement>('[data-canvas-tool-mode]')!;
  act(() => canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
  act(() => vi.advanceTimersByTime(300));
  expect(state.props.nodes[0].data.name).toBeUndefined();
  expect(viewportState.changed.mock.lastCall?.[0].viewport).toEqual(viewportState.current);
};
export const verifyVideoReferenceModes = async () => {
  const model = 'doubao-seedance-2-0-260128';
  state.models = { capabilityStatus: 'loaded', image: [], video: [{ id: model }], audio: [], chat: [] };
  await mount([
    { id: 'image', type: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', url: '/image.png' } },
    { id: 'audio', type: 'audio', position: { x: 0, y: 200 }, data: { kind: 'audio', url: '/audio.mp3' } },
    { id: 'task', type: 'videoTask', position: { x: 500, y: 0 }, data: { kind: 'videoTask', model, inputMode: 'multimodal', prompt: 'test', mediaPaths: [], status: 'idle' } },
  ]);
  const mode = () => state.props.nodes.find((node: CanvasNode) => node.id === 'task').data.inputMode;
  expect(mode()).toBe('text_to_video');
  await act(async () => state.props.onConnect({ source: 'image', target: 'task' }));
  expect(mode()).toBe('multimodal');
  await act(async () => state.editor.changeTaskModel('task', 'minimax-h3'));
  expect(mode()).toBe('multimodal');
  await act(async () => state.props.onConnect({ source: 'audio', target: 'task' }));
  const edges = [...state.props.edges];
  await act(async () => state.props.onEdgesChange([{ id: edges[0].id, type: 'remove' }]));
  expect(mode()).toBe('multimodal');
  await act(async () => state.props.onEdgesChange([{ id: edges[1].id, type: 'remove' }]));
  expect(mode()).toBe('text_to_video');
  await act(async () => state.editor.changeTaskModel('task', model));
  expect(mode()).toBe('text_to_video');
};

export const verifyConnectedTaskPanel = async (kind: string) => {
    const source: CanvasNode = { id: 'source', type: 'image', position: { x: 0, y: 0 }, width: 200, height: 300, data: { kind: 'image', url: '/uploads/source.png' } };
    await mount([source]);
    const pane = document.createElement('div'); pane.className = 'react-flow__pane'; host.append(pane);
    await act(async () => state.props.onConnectStart({}, { nodeId: source.id, handleType: 'source' }));
    await act(async () => state.props.onConnectEnd({ target: pane, clientX: 400, clientY: 200 }, { isValid: false, from: { x: 200, y: 100 } }));
    const button = host.querySelector<HTMLButtonElement>(`[data-canvas-connection-kind="${kind}"]`)!;
    expect(button).not.toBeNull(); expect(button.disabled).toBe(false); await act(async () => button.click());
    const task = state.props.nodes.find((node: CanvasNode) => node.id !== source.id);
    expect(task.data.kind).toBe(kind); expect(state.props.edges).toHaveLength(1);
    expect(state.props.edges[0]).toMatchObject({ source: source.id, target: task.id });
    expect(state.props.edges[0].animated).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(state.props.edges[0].animated).toBe(true);
    if (kind === 'compare') {
      expect(task).toMatchObject({ width: 200, height: 300, data: { kind: 'compare', slider: 0.5 } });
      expect(state.editor.isTaskPanelVisible(task.id)).toBe(false);
      const second: CanvasNode = { ...source, id: 'second', data: { kind: 'image', url: '/uploads/second.png' } };
      await mount([source, second, task], state.props.edges);
      await act(async () => state.props.onConnect({ source: second.id, target: task.id, sourceHandle: null, targetHandle: 'canvas-task-body-target' }));
      expect(state.props.edges).toHaveLength(2);
      expect(state.props.edges[1]).toMatchObject({ source: second.id, target: task.id });
      expect(state.props.edges[1].targetHandle ?? null).toBeNull();
      await act(async () => state.props.onEdgesChange(state.props.edges.map((edge: any) => ({ id: edge.id, type: 'remove' }))));
      expect(state.props.edges).toHaveLength(0);
      await act(async () => state.props.onNodesChange([{ id: second.id, type: 'dimensions', dimensions: { width: 600, height: 350 }, setAttributes: true }]));
      await act(async () => state.props.onConnect({ source: second.id, target: task.id, sourceHandle: null, targetHandle: 'canvas-task-body-target' }));
      const reconnected = state.props.nodes.find((node: CanvasNode) => node.id === task.id);
      expect(reconnected).toMatchObject({ width: 600, height: 350 });
      const preventDefault = vi.fn();
      await act(async () => state.props.onNodeDoubleClick({ target: host, preventDefault, stopPropagation() {} }, reconnected));
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(state.props.nodes.find((node: CanvasNode) => node.id === task.id).selected).toBe(true);
      expect(state.submit).not.toHaveBeenCalled();
      return;
    }
    expect(state.editor.isTaskPanelVisible(task.id)).toBe(true);
    await act(async () => state.props.onNodeClick({ ctrlKey: true }, task));
    expect(state.editor.isTaskPanelVisible(task.id)).toBe(false);
    await act(async () => state.props.onNodeClick({}, task));
    await act(async () => vi.advanceTimersByTime(300));
    expect(state.editor.isTaskPanelVisible(task.id)).toBe(true);
    expect(state.submit).not.toHaveBeenCalled();
  };

export const verifyAudioConnection = async (
  sourceKind: 'image' | 'imageTask' | 'audio' | 'audioTask' | 'prompt' | 'video',
  seedAvailable = true,
  preferredModel = 'speech-2.8-hd',
) => {
  state.models = { image: [], video: [], chat: [], canvasDefault: null, capabilityStatus: 'loaded', audio:
    ['speech-2.8-hd', ...(seedAvailable ? ['seed-audio-1.0'] : [])]
      .map(id => ({ id, label: id, provider: 'test', category: 'audio' })),
  };
  writeCanvasTaskPreferences(localStorage, 'guest', { audio: { lastModel: preferredModel, byModel: {
    'speech-2.8-hd': { speed: 1.2 }, 'seed-audio-1.0': { audioFormat: 'ogg_opus', sampleRate: 48000 },
  } } });
  const source: CanvasNode = {
    id: 'source', type: sourceKind, position: { x: 0, y: 0 }, width: 200, height: 300,
    data: sourceKind === 'imageTask' ? imageTask().data
      : sourceKind === 'audioTask' ? { kind: 'audioTask', model: 'speech-2.8-hd', prompt: '', voiceId: 'female-shaonv',
        speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: '',
        status: 'success', outputUrl: '/uploads/source.mp3', durationSeconds: 10 }
      : sourceKind === 'prompt' ? { kind: 'prompt', text: '用温柔的声音说你好' }
      : sourceKind === 'audio' ? { kind: 'audio', url: '/uploads/source.mp3', durationSeconds: 10 }
      : sourceKind === 'video' ? { kind: 'video', url: '/uploads/source.mp4' }
      : { kind: 'image', url: '/uploads/source.png' },
  };
  await mount([source]);
  const pane = document.createElement('div'); pane.className = 'react-flow__pane'; host.append(pane);
  await act(async () => state.props.onConnectStart({}, { nodeId: source.id, handleType: 'source' }));
  await act(async () => state.props.onConnectEnd({ target: pane, clientX: 400, clientY: 200 }, { isValid: false, from: { x: 200, y: 100 } }));
  const button = host.querySelector<HTMLButtonElement>('[data-canvas-connection-kind="audioTask"]')!;
  expect(button).not.toBeNull();
  if (sourceKind === 'video' || (!seedAvailable && sourceKind !== 'prompt')) {
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(state.props.nodes).toHaveLength(1); expect(state.props.edges).toHaveLength(0);
    return;
  }
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  const task = state.props.nodes.find((node: CanvasNode) => node.id !== source.id);
  const expectedModel = sourceKind === 'prompt' ? preferredModel : 'seed-audio-1.0';
  expect(task.data).toMatchObject({ kind: 'audioTask', model: expectedModel });
  expect(state.props.edges).toHaveLength(1);
  expect(state.props.edges[0]).toMatchObject({ source: source.id, target: task.id });
  expect(state.editor.isTaskPanelVisible(task.id)).toBe(true);
  if (expectedModel === 'seed-audio-1.0') expect(task.data).toMatchObject({ audioFormat: 'ogg_opus', sampleRate: 48000 });
  expect(state.submit).not.toHaveBeenCalled();
  if (sourceKind === 'imageTask') return;
  await act(async () => state.editor.updateData(task.id, (data: any) => ({ ...data, prompt: '用温柔的声音说你好' })));
  await act(async () => { expect(await state.editor.runNode(task.id)).toBe(true); });
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.submit.mock.calls[0][0]).toMatchObject({ model: expectedModel });
  if (sourceKind !== 'prompt') {
    expect(state.submit.mock.calls[0][0].references).toEqual(sourceKind === 'image'
      ? [{ kind: 'image', url: '/uploads/source.png' }]
      : [{ kind: 'audio', url: '/uploads/source.mp3', durationSeconds: 10 }]);
  }
};

export const verifyPersonalMaterialDrop = async (inside: boolean) => {
  state.screenToFlow.mockImplementation((point: any) => ({ x: (point.x - viewportState.current.x) / viewportState.current.zoom, y: (point.y - viewportState.current.y) / viewportState.current.zoom }));
  const group: CanvasNode = { id: 'drop-group', type: 'group', position: { x: 100, y: 200 }, width: 600, height: 400, data: { kind: 'group', title: '组', collapsed: false } };
  await mount([group]);
  viewportState.current = { x: 83, y: -41, zoom: 0.25 };
  const point = inside ? { x: 696, y: 596 } : { x: 852, y: 652 };
  let finish!: (value: unknown) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
  const drop = new MouseEvent('drop', { bubbles: true, clientX: point.x * 0.25 + 83, clientY: point.y * 0.25 - 41 });
  Object.defineProperty(drop, 'dataTransfer', { value: { getData: (type: string) => type === 'application/x-canvas-personal-material' ? 'material-1' : '', files: [] } });
  await act(async () => host.querySelector('.canvas-editor-surface')!.dispatchEvent(drop));
  // Network completion must not recalculate the destination using the new viewport.
  viewportState.current = { x: -500, y: 300, zoom: 2 };
  await act(async () => finish(new Response(JSON.stringify({ success: true, media: { kind: 'image', url: '/imported.png', mediaId: 'media-1', name: '素材', variants: { original: { width: 1000, height: 800 } } } }))));
  const added = state.props.nodes.find((n: CanvasNode) => n.data.kind === 'image');
  expect(added.parentId).toBe(inside ? group.id : undefined);
  expect(canvasNodeWorldPosition(added, new Map(state.props.nodes.map((n: CanvasNode) => [n.id, n])))).toEqual(point);
  expect(state.props.edges).toHaveLength(0);
};

export const verifyFlowPropsDuringAlignment = async () => {
  const node: CanvasNode = { id: 'dragged', type: 'image', position: { x: 0, y: 0 }, width: 200, height: 300, data: { kind: 'image', url: '/a.png' } };
  await mount([node, { ...node, id: 'target', position: { x: 500, y: 500 } }]);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON() {} });
  await act(async () => state.props.onNodeDragStart({}, state.props.nodes[0]));
  const keys = ['onInit', 'onSelectionDragStart', 'onSelectionDragStop', 'onSelectionStart', 'onSelectionEnd', 'onPaneClick', 'onPaneContextMenu', 'onMoveStart', 'onMoveEnd', 'panOnDrag', 'multiSelectionKeyCode'];
  const handlers = Object.fromEntries(keys.map(key => [key, state.props[key]]));
  for (const x of [20, 40, 60]) {
    await act(async () => state.props.onNodesChange([{ type: 'position', id: node.id, position: { x, y: 501 }, dragging: true }]));
    await act(async () => vi.advanceTimersByTime(30));
    expect(state.props.nodes[0].position).toEqual({ x, y: 500 });
    expect(host.querySelector('.canvas-alignment-guide')).not.toBeNull();
    for (const [key, handler] of Object.entries(handlers)) expect(state.props[key], key).toBe(handler);
  }
  await act(async () => state.props.onNodeDragStop());
  expect(state.props.nodes[0].position).toEqual({ x: 60, y: 500 });
};

export const verifyTextReferenceSubmission = async (kind: string) => {
  const source: CanvasNode = { id: 'text-ref', type: 'prompt', position: { x: 0, y: 0 }, data: { kind: 'prompt', text: '人物保留', format: 'markdown' } };
  const task: CanvasNode = kind === 'imageTask' ? imageTask('nano-banana-pro', 0) : { id: 'task', type: 'videoTask', position: { x: 400, y: 0 }, data: { kind: 'videoTask', model: 'doubao-seedance-2-0', prompt: '', mediaPaths: [], status: 'idle' } };
  if (task.data.kind === 'imageTask') task.data.task.settings.prompt = '';
  await mount([source, task], [{ id: 'text-edge', source: source.id, target: task.id }]);
  expect(state.editor.getTaskTextReferences(task.id)).toMatchObject([{ id: source.id, content: '人物保留' }]);
  await act(async () => state.editor.updateData(source.id, (data: any) => ({ ...data, text: '背景保留' })));
  expect(state.editor.getTaskTextReferences(task.id)[0].content).toBe('背景保留');
  await act(async () => { expect(await state.editor.runNode(task.id)).toBe(true); });
  expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({ prompt: '', textList: ['背景保留'] }));
  await act(async () => state.editor.removeTaskReference(task.id, source.id));
  expect(state.editor.getTaskTextReferences(task.id)).toEqual([]);
  expect(state.props.edges).toHaveLength(0);
  expect(state.props.nodes.find((node: CanvasNode) => node.id === source.id).data.text).toBe('背景保留');
};

export const verifyNodeContextActions = async (multiple: boolean) => {
  const nodes: CanvasNode[] = ['a', 'b', 'other'].map(id => ({ id, type: 'image', position: { x: 0, y: 0 }, width: 350, height: 350, data: { kind: 'image', url: `/uploads/${id}.png` } }));
  const open = async () => {
    const event = { clientX: 400, clientY: 200, preventDefault() {} };
    await act(async () => multiple ? state.props.onSelectionContextMenu(event, state.props.nodes.slice(0, 2)) : state.props.onNodeContextMenu(event, state.props.nodes[0]));
  };
  const action = (name: string) => host.querySelector<HTMLButtonElement>(`[data-canvas-node-action="${name}"]`)!;
  await mount(nodes);
  await open();
  expect(Array.from(host.querySelectorAll('[data-canvas-node-action]')).map(button => button.textContent)).toEqual(['保存到素材库', '复制节点', '副本', '粘贴', '删除']);
  expect(action('paste').disabled).toBe(true);
  await act(async () => action('save').click());
  expect(state.library.open).toBe(true);
  expect(state.library.items.map((item: any) => item.sourceNodeId)).toEqual(multiple ? ['a', 'b'] : ['a']);
  await mount(nodes);
  await open();
  await act(async () => action('copy').click());
  expect(state.props.nodes).toHaveLength(3);
  await open();
  expect(action('paste').disabled).toBe(false);
  await act(async () => action('paste').click());
  expect(state.props.nodes).toHaveLength(multiple ? 5 : 4);
  await mount(nodes);
  await open();
  await act(async () => action('duplicate').click());
  expect(state.props.nodes).toHaveLength(multiple ? 5 : 4);
  await mount(nodes);
  await open();
  await act(async () => action('delete').click());
  expect(state.props.nodes.map((node: CanvasNode) => node.id)).toEqual(multiple ? ['other'] : ['b', 'other']);
  await mount([{ id: 'empty', type: 'compare', position: { x: 0, y: 0 }, data: { kind: 'compare', beforeUrl: '', afterUrl: '', slider: 0.5 } }]);
  await open();
  expect(action('save').disabled).toBe(true);
};

export const verifyMoveOutContextAction = async (multiple: boolean) => {
  const group: CanvasNode = { id: 'g', type: 'group', position: { x: 100, y: 100 }, width: 800, height: 700, data: { kind: 'group', title: '组', collapsed: false } };
  const children: CanvasNode[] = ['a', 'b'].map((id, i) => ({ id, parentId: 'g', type: 'image', position: { x: 80, y: 100 + i * 250 }, width: 200, height: 200, data: { kind: 'image', url: `/${id}.png` } }));
  await mount([group, ...children], [{ id: 'ab', source: 'a', target: 'b' }]);
  const event = { clientX: 400, clientY: 200, preventDefault() {} };
  const targets = state.props.nodes.filter((node: CanvasNode) => node.id === 'a' || (multiple && node.id === 'b'));
  await act(async () => multiple ? state.props.onSelectionContextMenu(event, targets) : state.props.onNodeContextMenu(event, targets[0]));
  const action = host.querySelector<HTMLButtonElement>('[data-canvas-node-action="move-out-of-group"]')!;
  expect(action?.textContent).toBe('移出组内');
  await act(async () => action.click());
  expect(state.props.nodes.find((node: CanvasNode) => node.id === 'a').parentId).toBeUndefined();
  expect(state.props.nodes.find((node: CanvasNode) => node.id === 'b').parentId).toBe(multiple ? undefined : 'g');
  expect(state.props.edges).toHaveLength(1);
  expect(state.props.nodes).toHaveLength(3);
  expect(host.querySelector('[data-canvas-node-action="move-out-of-group"]')).toBeNull();
};

export async function verifyLlmMediaSubmission() {
  state.models = { capabilityStatus: 'loaded', chat: [{ providerId: 'bailian', modelId: 'qwen3.8-omni-flash', thinkingLevels: ['default', 'none', 'low', 'medium', 'high'] }], canvasDefault: { providerId: 'bailian', modelId: 'qwen3.8-omni-flash' }, image: [], video: [], audio: [] };
  const media: CanvasNode[] = (['video', 'audio', 'image'] as const).map(kind => ({ id: kind, type: kind, position: { x: 0, y: 0 }, data: { kind, url: `/uploads/${kind}`, ...(kind === 'video' ? { posterUrl: '/uploads/poster.jpg' } : {}) } }));
  await mount([...media, { id: 'llm', type: 'llm', position: { x: 600, y: 0 }, data: { kind: 'llm', providerId: 'bailian', model: 'qwen3.8-omni-flash', thinkingLevel: 'high', prompt: 'describe', status: 'idle' } }], media.map(n => ({ id: n.id, source: n.id, target: 'llm' })));
  await act(async () => { await state.editor.runNode('llm'); });
  const call = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/canvas/llm');
  expect(call).toBeDefined();
  const body = JSON.parse(String(call![1]!.body));
  expect(body.mediaReferences).toEqual(media.map(n => ({ kind: n.data.kind, url: `/uploads/${n.data.kind}` })));
  expect(body.thinkingLevel).toBe('high');
  expect(body).not.toHaveProperty('imageUrls');
  expect(state.upload).not.toHaveBeenCalled();
}

export const verifyAudioClipExport = async (kind: 'audio' | 'audioTask', fail = false, speed?: number) => {
  const source: CanvasNode = {
    id: 'source', type: kind, position: { x: 0, y: 0 }, width: 420, height: 200,
    data: kind === 'audio' ? { kind, name: '林度.wav', url: '/original.wav', origin: 'upload' } : {
      kind, title: '林度.wav', model: 'speech-2.8-hd', prompt: '你好', voiceId: '',
      speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0,
      soundEffect: '', status: 'success', outputUrl: '/original.wav',
    },
  };
  await mount([source]);
  const original = state.props.nodes.find((node: CanvasNode) => node.id === 'source').data;
  const clip = { blob: new Blob(['wav'], { type: 'audio/wav' }), waveformPeaks: [20, 80], durationSeconds: 1.5 };
  state.upload.mockResolvedValue({ url: '/clip.wav', mediaId: 'clip-media' });
  if (fail) {
    state.upload.mockRejectedValueOnce(new Error('上传失败'));
    await act(async () => { await expect(state.editor.exportAudioClip('source', clip, '/original.wav')).rejects.toThrow('上传失败'); });
    expect(state.props.nodes).toHaveLength(1);
    expect(state.props.edges).toHaveLength(0);
    return;
  }
  await act(async () => state.editor.exportAudioClip('source', clip, '/original.wav', speed));
  const result = state.props.nodes.find((node: CanvasNode) => node.id !== 'source');
  const name = speed === undefined ? '林度_截取' : `林度_${speed}x`;
  expect(state.upload.mock.calls[0][0]).toMatchObject({ name: `${name}.wav`, type: 'audio/wav' });
  expect(result).toMatchObject({ width: 420, height: 200, data: { kind: 'audio', url: '/clip.wav', name, mediaId: 'clip-media', waveformPeaks: [20, 80], durationSeconds: 1.5 } });
  expect(state.props.edges).toContainEqual(expect.objectContaining({ source: 'source', target: result.id }));
  expect(state.props.nodes.find((node: CanvasNode) => node.id === 'source').data).toEqual(original);
  await act(async () => { await expect(state.editor.exportAudioClip('source', clip, '/changed.wav')).rejects.toThrow('原音频已变更'); });
  expect(state.upload).toHaveBeenCalledTimes(1);
};

export const verifyCanvasBatchDownloadNames = async (mode: 'rerun' | 'same-name' | 'multiple-outputs' | 'renamed-group' | 'latest-failed' | 'renamed-task' | 'renamed-media') => {
  vi.useRealTimers();
  const JSZip = (await import('jszip')).default;
  const archives: Blob[] = [];
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { archives.push(blob); return 'blob:canvas-download-test'; }
    static revokeObjectURL() {}
  });
  const downloadNames: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloadNames.push(this.download); });
  const fetched: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetched.push(url);
    return { ok: true, blob: async () => new Blob([url], { type: 'image/png' }) };
  }));
  const task = imageTask();
  if (task.data.kind !== 'imageTask') throw new Error('Expected image task');
  task.parentId = 'group';
  task.data.title = '陈秀兰 46岁';
  const settings = task.data.task.settings;
  task.data.task.batches = [
    { id: 'old', createdAt: 1, settings, outputs: [{ id: 'old-image', status: 'success', url: '/old.png' }] },
    { id: 'current', createdAt: 2, settings, outputs: [
      { id: 'current-image', status: mode === 'latest-failed' ? 'failed' : 'success', url: '/current.png' },
      ...(mode === 'multiple-outputs' ? [{ id: 'second-image', status: 'success' as const, url: '/second.png' }] : []),
    ] },
  ];
  const nodes: CanvasNode[] = [
    { id: 'group', type: 'group', position: { x: 0, y: 0 }, data: { kind: 'group', title: '角色', collapsed: false } }, task,
    ...(['same-name', 'renamed-task', 'renamed-media'].includes(mode) ? [{ id: 'other', type: 'image' as const, parentId: 'group', position: { x: 500, y: 0 }, data: { kind: 'image' as const, name: '陈秀兰 46岁', url: '/other.png' } }] : []),
  ];
  await mount(nodes);
  if (mode === 'renamed-task' || mode === 'renamed-media') {
    // Download immediately after the editor commits the rename, before a rerender.
    await act(async () => {
      state.editor.updateData(mode === 'renamed-task' ? task.id : 'other', (data: CanvasNode['data']) => renameCanvasNodeData(data, '周承远，39岁'), 'push');
      state.editor.groupAction('group', 'download');
      await vi.waitFor(() => expect(archives).toHaveLength(1), { timeout: 3000 });
    });
  }
  if (mode === 'renamed-group') {
    await act(async () => state.editor.updateData('group', (data: CanvasNode['data']) => ({ ...data, title: '女性角色' })));
  }
  if (mode === 'latest-failed') {
    await act(async () => {
      state.editor.groupAction('group', 'download');
      await Promise.resolve();
    });
    expect(archives).toHaveLength(0);
    expect(fetched.filter(url => url.endsWith('.png'))).toEqual([]);
    expect(host.textContent).toContain('分组中没有可下载的媒体');
    return;
  }
  if (!archives.length) await act(async () => {
    state.editor.groupAction('group', 'download');
    await vi.waitFor(() => expect(archives).toHaveLength(1), { timeout: 3000 });
  });
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(archives[0]);
  });
  const zip = await JSZip.loadAsync(bytes);
  expect(downloadNames).toEqual([mode === 'renamed-group' ? '女性角色.zip' : '角色.zip']);
  const files = Object.values(zip.files).filter(file => !file.dir);
  const expectedUrls = ['same-name', 'renamed-task', 'renamed-media'].includes(mode) ? ['/current.png', '/other.png'] : mode === 'multiple-outputs' ? ['/current.png', '/second.png'] : ['/current.png'];
  expect(fetched.filter(url => url.endsWith('.png'))).toEqual(expectedUrls);
  expect(files).toHaveLength(expectedUrls.length);
  if (mode === 'renamed-task' || mode === 'renamed-media') {
    expect(files.map(file => file.name)).toEqual(mode === 'renamed-task'
      ? ['周承远，39岁.png', '陈秀兰 46岁.png']
      : ['陈秀兰 46岁.png', '周承远，39岁.png']);
    expect(Object.values(zip.files).some(file => file.dir)).toBe(false);
  } else {
    expect(files.map(file => file.name.split('/').at(-1))).toEqual(files.map(() => '陈秀兰 46岁.png'));
  }
  if (expectedUrls.length === 1) expect(files[0].name).toBe('陈秀兰 46岁.png');
  expect(await Promise.all(files.map(file => file.async('string')))).toEqual(expectedUrls);
};

export const verifyVideoClipExport = async (kind: 'video' | 'videoTask', fail = false, operation?: 'crop') => {
  const source: CanvasNode = { id: 'source', type: kind, position: { x: 0, y: 0 }, width: 420, height: 236,
    data: kind === 'video' ? { kind, name: '角色.mp4', url: '/original.mp4', origin: 'upload' } : {
      kind, title: '角色.mp4', mediaPaths: [], model: '', prompt: '', status: 'success', outputUrl: '/original.mp4',
    },
  };
  await mount([source]);
  const original = state.props.nodes.find((node: CanvasNode) => node.id === 'source').data;
  const clip = { blob: new Blob(['mp4'], { type: 'video/mp4' }), width: 1920, height: 1080, durationSeconds: 5.15 };
  state.upload.mockResolvedValue({ url: '/clip.mp4', mediaId: 'clip-media' });
  if (fail) {
    state.upload.mockRejectedValueOnce(new Error('上传失败'));
    await act(async () => { await expect(state.editor.exportVideoClip('source', clip, '/original.mp4', operation)).rejects.toThrow('上传失败'); });
    expect(state.props.nodes).toHaveLength(1); expect(state.props.edges).toHaveLength(0); return;
  }
  await act(async () => state.editor.exportVideoClip('source', clip, '/original.mp4', operation));
  const result = state.props.nodes.find((node: CanvasNode) => node.id !== 'source');
  expect(state.upload.mock.calls[0][0]).toMatchObject({ name: operation === 'crop' ? '角色_裁剪.mp4' : '角色_截取.mp4', type: 'video/mp4' });
  expect(result).toMatchObject({ data: { kind: 'video', url: '/clip.mp4', name: operation === 'crop' ? '角色_裁剪' : '角色_截取', mediaId: 'clip-media', durationSeconds: 5.15 } });
  expect(result.width / result.height).toBeCloseTo(1920 / 1080, 1);
  expect(state.props.edges).toContainEqual(expect.objectContaining({ source: 'source', target: result.id }));
  expect(state.props.nodes.find((node: CanvasNode) => node.id === 'source').data).toEqual(original);
  await act(async () => { await expect(state.editor.exportVideoClip('source', clip, '/changed.mp4', operation)).rejects.toThrow('原视频已变更'); });
  expect(state.upload).toHaveBeenCalledTimes(1);
};

export const verifyVideoSeparation = async (kind: 'video' | 'videoTask', failure?: 'upload' | 'changed' | 'abort', mode: 'tracks' | 'vocals' | 'background' = 'tracks') => {
  const source: CanvasNode = { id: 'source', type: kind, position: { x: 0, y: 0 }, width: 420, height: 560,
    data: kind === 'video' ? { kind, name: '稳哒.mp4', url: '/original.mp4', origin: 'upload' } : {
      kind, title: '稳哒.mp4', mediaPaths: [], model: '', prompt: '', status: 'success', outputUrl: '/original.mp4',
    },
  };
  await mount([source]);
  const controller = new AbortController();
  vi.mocked(fetch).mockResolvedValue(new Response(new Blob(['stem'], { type: 'audio/wav' })));
  const audioName = `稳哒_${mode === 'vocals' ? '人声' : mode === 'background' ? '背景音' : '音轨'}`;
  const extension = mode === 'tracks' ? 'm4a' : 'wav';
  state.upload.mockImplementation(async (file: File) => {
    if (file.type === 'video/mp4' && failure === 'upload') throw new Error('上传失败');
    if (failure === 'abort') controller.abort();
    if (failure === 'changed') state.editor.updateData('source', (data: any) => ({ ...data, url: '/changed.mp4', outputUrl: '/changed.mp4' }));
    return { url: file.type === 'video/mp4' ? '/silent.mp4' : '/audio.m4a', mediaId: file.type };
  });
  if (failure) {
    await act(async () => { await expect(state.editor.separateVideo('source', '/original.mp4', vi.fn(), controller.signal, mode)).rejects.toThrow(); });
    expect(state.props.nodes).toHaveLength(1); expect(state.props.edges).toHaveLength(0); return;
  }
  await act(async () => state.editor.separateVideo('source', '/original.mp4', vi.fn(), controller.signal, mode));
  expect(state.upload.mock.calls.map(call => call[0].name)).toEqual([`${audioName}.${extension}`, '稳哒_无声.mp4']);
  const audio = state.props.nodes.find((node: CanvasNode) => node.data.kind === 'audio');
  const video = state.props.nodes.find((node: CanvasNode) => node.id !== 'source' && node.data.kind === 'video');
  expect(audio.data).toMatchObject({ name: audioName, url: '/audio.m4a', durationSeconds: 15 });
  expect(video.data).toMatchObject({ name: '稳哒_无声', url: '/silent.mp4', variants: { original: { width: 834, height: 1112 } } });
  for (const result of [audio, video]) expect(state.props.edges).toContainEqual(expect.objectContaining({ source: 'source', target: result.id }));
  expect(state.props.nodes.find((node: CanvasNode) => node.id === 'source').data).toMatchObject(source.data);
  expect(state.props.nodes).toHaveLength(3);
};

export const verifyVideoSeparationBackground = async (mode: 'tracks' | 'vocals' | 'background') => {
  await mount([{ id: 'source', type: 'video', position: { x: 0, y: 0 }, width: 420, height: 560,
    data: { kind: 'video', name: '后台素材', url: '/original.mp4', origin: 'upload' } }]);
  let finish!: (value: any) => void;
  state.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ url: '/silent.mp4', mediaId: 'silent' });
  vi.mocked(fetch).mockResolvedValue(new Response(new Blob(['stem'], { type: 'audio/wav' })));
  let pending!: Promise<void>;
  await act(async () => { pending = state.editor.separateVideo('source', '/original.mp4', undefined, undefined, mode); });
  expect(state.editor.videoSeparationJobs.source).toMatchObject({ mode, status: 'running' });
  await act(async () => { await expect(state.editor.separateVideo('source', '/original.mp4')).rejects.toThrow('正在分离'); });
  await act(async () => state.props.onPaneClick());
  expect(state.editor.videoSeparationJobs.source.status).toBe('running');
  await act(async () => { finish({ url: '/audio.wav', mediaId: 'stem' }); await pending; });
  expect(state.editor.videoSeparationJobs.source.status).toBe('success');
  expect(state.props.nodes).toHaveLength(3);
  expect(state.props.edges).toHaveLength(2);
};

export const verifySubtitleRemovalTask = async (outcome: 'success' | 'failure' | 'cancel-before-queued') => {
  await mount([{ id: 'source', type: 'video', position: { x: 50, y: 80 }, data: { kind: 'video', name: '自定义视频', url: '/uploads/source.mp4' } }]);
  let saved!: (revision: string) => void;
  state.save.mockImplementationOnce(() => new Promise(resolve => { saved = resolve; }));
  const fetch = vi.mocked(globalThis.fetch);
  fetch.mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === 'POST'
    ? outcome === 'failure' ? { success: false, error: '队列不可用' } : { success: true, executionMode: 'server', run: { id: 901 } }
    : { success: true }), { status: outcome === 'failure' && init?.method === 'POST' ? 503 : 200 }));
  let pending!: Promise<void>;
  await act(async () => { pending = state.editor.removeVideoSubtitles('source', '/uploads/source.mp4', { mode: 'auto' }, { width: 834, height: 1112 }); });
  const result = state.props.nodes.find((node: any) => node.id !== 'source');
  expect(result.data).toMatchObject({ kind: 'videoTask', title: '自定义视频_去字幕', ratio: '834:1112', status: 'running' });
  expect(state.props.edges).toContainEqual(expect.objectContaining({ source: 'source', target: result.id }));
  expect(state.submit).not.toHaveBeenCalled();
  if (outcome === 'cancel-before-queued') await act(async () => { state.editor.cancelNode(result.id); });
  await act(async () => {
    saved('11');
    if (outcome === 'failure') await expect(pending).rejects.toThrow('未能启动');
    else await pending;
  });
  expect(state.props.nodes.find((node: any) => node.id === result.id).data.status).toBe(outcome === 'failure' ? 'failed' : outcome === 'cancel-before-queued' ? 'cancelled' : 'running');
  const submission = fetch.mock.calls.find(([url, init]) => String(url).endsWith('/runs') && init?.method === 'POST');
  expect(JSON.parse(String(submission?.[1]?.body))).toMatchObject({ expectedRevision: '11', nodeIds: [result.id] });
  if (outcome === 'cancel-before-queued') expect(fetch.mock.calls.some(([url, init]) => String(url) === '/api/canvas/runs/901' && init?.method === 'PATCH')).toBe(true);
};

export const verifyConcurrentSubtitleRemoval = async (restore = false) => {
  if (restore) state.runItems = [901, 902].map(id => ({ id, status: "running", state: { nodeIds: [`existing-${id}`], nodes: {} } }));
  await mount([{ id: 'source', type: 'video', position: { x: 0, y: 0 }, data: { kind: 'video', url: '/uploads/source.mp4' } }]);
  const fetch = vi.mocked(globalThis.fetch);
  let nextRun = restore ? 902 : 900;
  fetch.mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === 'POST'
    ? { success: true, executionMode: 'server', run: { id: ++nextRun } }
    : { success: true }), { status: 200 }));
  for (const mode of ['auto', 'region'] as const) {
    await act(async () => state.editor.removeVideoSubtitles('source', '/uploads/source.mp4', mode === 'auto'
      ? { mode } : { mode, regions: [{ x: 0, y: .7, width: 1, height: .2 }] }, { width: 834, height: 1112 }));
  }
  const results = state.props.nodes.filter((node: CanvasNode) => node.id !== 'source');
  expect(results).toHaveLength(2);
  expect(results.every((node: any) => node.data.status === 'running')).toBe(true);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  for (const runId of (restore ? [901, 902, 903, 904] : [901, 902])) expect(fetch.mock.calls.some(([url, init]) => String(url) === `/api/canvas/runs/${runId}` && !init?.method)).toBe(true);
  await act(async () => state.editor.cancelNode(results[0].id));
  const cancellations = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  expect(cancellations.map(([url]) => url)).toEqual([`/api/canvas/runs/${restore ? 903 : 901}`]);
  expect(state.props.nodes.find((node: any) => node.id === results[1].id).data.status).toBe('running');
};
