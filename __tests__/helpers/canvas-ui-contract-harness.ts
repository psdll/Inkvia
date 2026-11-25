// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import type { CanvasNodeData } from '@/lib/canvas/document';
import { createCanvasQueryHarness, installCanvasDomMeasurements } from './canvas-runtime-harness';
const state = vi.hoisted(() => ({ panel: false, preview: vi.fn(), presets: vi.fn(), startWriting: vi.fn(), removeReference: vi.fn(), locate: vi.fn(), textReferences: [] as any[], models: null as any }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/canvas/use-canvas-models', async original => ({ ...await original<any>(), useCanvasModels: () => state.models, resolveCanvasModelId: (items: any[], id: string) => items.some(item => item.id === id) ? id : '' }));
vi.mock('@xyflow/react', async original => ({
  ...await original<any>(),
  Handle: () => null, useNodeId: () => 'node', useConnection: () => false, useUpdateNodeInternals: () => () => {},
  NodeToolbar: ({ children, className }: any) => React.createElement('div', { className }, children),
  useStore: (select: any) => select({ edges: [], transform: [0, 0, 1], nodeLookup: new Map([['node', { measured: { width: 350 } }]]) }),
}));
import { CanvasNodeCard, CanvasNodeEditorContext } from '@/components/canvas/CanvasNodeCard';
import { CanvasAudioPlaybackProvider } from '@/components/canvas/CanvasAudioPlayback';
import CanvasMediaPreview from '@/components/canvas/CanvasMediaPreview';
let root: Root, host: HTMLDivElement, queries: ReturnType<typeof createCanvasQueryHarness>;
let restoreMeasurements: () => void;
beforeEach(() => {
  restoreMeasurements = installCanvasDomMeasurements();
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.textReferences = []; state.removeReference.mockClear(); state.locate.mockClear();
  state.panel = false; state.models = null; state.preview.mockClear(); state.presets.mockClear(); state.startWriting.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, items: [] }), { status: 200 })));
  queries = createCanvasQueryHarness(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { act(() => root.unmount()); await queries.dispose(); host.remove(); restoreMeasurements(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const settings = { model: 'gpt-image-2-official-reapi', prompt: 'a scene', aspectRatio: '1:1', resolution: '2K', quality: 'medium', count: 1 };
const dataFor = (kind: string, success = false): CanvasNodeData => {
  if (kind === 'imageTask') return { kind, task: { settings, references: [], batches: success ? [{ id: 'batch', createdAt: 1, settings, outputs: [{ id: 'output', status: 'success', url: '/uploads/result.png' }] }] : [] } };
  if (kind === 'videoTask') return { kind, model: '', prompt: '', mediaPaths: [], status: success ? 'success' : 'idle', ...(success ? { outputUrl: '/uploads/result.mp4' } : {}) };
  if (kind === 'audioTask') return { kind, model: '', prompt: '', status: success ? 'success' : 'idle', ...(success ? { outputUrl: '/uploads/result.mp3' } : {}) } as CanvasNodeData;
  if (kind === 'llm') return { kind, prompt: '', status: 'idle' };
  return { kind, url: `/uploads/source.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3'}` } as CanvasNodeData;
};
async function renderNode(data: CanvasNodeData) {
  const editor = { isPanelVisible: () => true, isTaskPanelVisible: () => state.panel, isGroupSelected: () => false,
    getTaskTextReferences: () => state.textReferences, removeTaskReference: state.removeReference, locateCanvasNode: state.locate,
    getTaskAssets: () => [], getMediaName: () => '素材', getTaskResultName: () => '结果',
    connectionInProgress: false, connectionFeedbackTarget: null, previewMedia: state.preview,
    previewOutput: state.preview, openTemplate: state.presets, startTextWriting: state.startWriting, updateData: vi.fn(), runNode: vi.fn(),
  } as any;
  const node = React.createElement(CanvasNodeCard, { id: 'node', type: data.kind, data, selected: true, dragging: false,
    isConnectable: true, zIndex: 0, draggable: true, selectable: true, deletable: true, positionAbsoluteX: 0, positionAbsoluteY: 0 });
  await act(async () => root.render(queries.wrap(React.createElement(ReactFlowProvider, null,
    React.createElement(CanvasNodeEditorContext.Provider, { value: editor },
      React.createElement(CanvasAudioPlaybackProvider, { nodeIds: ['node'], children: node }))))));
  return editor;
}
export const verifyLlmThinkingSelection = async (providerId: string, modelId: string, thinkingLevels: string[], label: string, value: string) => {
  state.models = { capabilityStatus: 'loaded', image: [], audio: [], video: [], chat: [{ providerId, modelId, thinkingLevels }], canvasDefault: { providerId, modelId } };
  state.panel = true;
  const data = { kind: 'llm', providerId, model: modelId, prompt: '', status: 'idle' } as const;
  const editor = await renderNode(data);
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="LLM 思考设置"]')!;
  expect(trigger).not.toBeNull();
  await act(async () => trigger.click());
  const options = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options).toHaveLength(thinkingLevels.length);
  const choice = options.find(option => option.textContent === label)!;
  expect(choice).toBeDefined();
  await act(async () => choice.click());
  const [nodeId, update] = editor.updateData.mock.calls.at(-1);
  expect(nodeId).toBe('node');
  expect(update(data)).toMatchObject({ thinkingLevel: value, providerId, model: modelId });
};
export const verifyLlmDisplayNameSelection = async () => {
  state.models = { capabilityStatus: 'loaded', image: [], audio: [], video: [], chat: [
    { providerId: 'one', modelId: 'shared', label: '文本助手' },
    { providerId: 'two', modelId: 'shared', label: '备用助手' },
  ], canvasDefault: { providerId: 'one', modelId: 'shared' } };
  state.panel = true;
  const data = { kind: 'llm', providerId: 'one', model: 'shared', prompt: '', status: 'idle' } as const;
  const editor = await renderNode(data);
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="LLM 模型"]')!;
  expect(trigger.textContent).toContain('文本助手');
  await act(async () => trigger.click());
  const options = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options.map(option => option.textContent)).toEqual(['文本助手', '备用助手']);
  await act(async () => options.find(option => option.textContent === '备用助手')!.click());
  const [nodeId, update] = editor.updateData.mock.calls.at(-1);
  expect(nodeId).toBe('node');
  expect(update(data)).toMatchObject({ providerId: 'two', model: 'shared' });
};
export const verifyPresetTrigger = async (kind: string) => {
  state.panel = true; await renderNode(dataFor(kind));
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent === '预设提示词');
  expect(buttons).toHaveLength(1); expect(buttons[0].querySelector('svg')).not.toBeNull();
  await act(async () => buttons[0].click()); expect(state.presets).toHaveBeenLastCalledWith('node');
};

export const verifyImageFallback = async () => {
  const images: any[] = [];
  vi.stubGlobal('Image', class { onload: any; onerror: any; src = ''; decoding = ''; decode = async () => {}; constructor() { images.push(this); } });
  const { CanvasMediaImage } = await import('@/components/canvas/CanvasMediaImage');
  await act(async () => root.render(React.createElement(CanvasMediaImage, { src: '/uploads/source.png', previewSize: { width: 400 } })));
  expect(images[0].src).toBe('/api/thumb?src=%2Fuploads%2Fsource.png&w=400');
  await act(async () => images[0].onerror());
  expect(images[1].src).toBe('/uploads/source.png');
  await act(async () => images[1].onload());
  expect(host.querySelector('img')?.getAttribute('src')).toBe('/uploads/source.png');
};

export const verifyMaterialToolbar = async (kind: string) => {
    await act(async () => root.render(null)); state.preview.mockClear();
    state.panel = true;
    await renderNode(dataFor(kind, true));
    const toolbar = host.querySelector('.canvas-material-toolbar')!;
    expect(toolbar).not.toBeNull();
    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.filter(button => button.getAttribute('aria-label') === '预览')).toHaveLength(1);
    expect(buttons.at(-1)?.getAttribute('aria-label')).toBe('预览');
    expect(buttons.at(-1)?.textContent).toBe('');
    await act(async () => buttons.at(-1)!.click()); expect(state.preview).toHaveBeenCalledOnce();
  };
export const verifyInlineAudio = async (kind: string) => {
    state.panel = true; await renderNode(dataFor(kind, true));
    expect(host.querySelector('[data-canvas-audio-node]')).not.toBeNull();
    const toolbar = host.querySelector('.canvas-material-toolbar')!;
    expect(toolbar.querySelector('[aria-label="下载"]')).not.toBeNull();
    expect(toolbar.querySelector('[aria-label="预览"]')).toBeNull();
  };
export const verifyTaskWorkspace = async (kind: string, placeholder: string) => {
    await renderNode(dataFor(kind));
    expect(host.querySelector(`[data-placeholder-kind="${placeholder}"]`)).not.toBeNull();
    state.panel = true; await renderNode(dataFor(kind));
    expect(host.querySelector('.canvas-generator-shell')).not.toBeNull();
    expect(host.querySelector('[data-placeholder-kind]')).not.toBeNull();
  };
export const verifyTextWritingEntry = async () => {
    await renderNode(dataFor('llm'));
    const start = host.querySelector('[data-canvas-text-start]')!;
    expect(start).not.toBeNull();
    const buttons = [...start.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map(button => button.textContent)).toEqual(['自己编写内容', '文生视频', '图片反推提示词', '文字生音乐']);
    expect(buttons[0].disabled).toBe(false);
    expect(buttons.slice(1).every(button => button.disabled)).toBe(true);
    expect(host.querySelector<HTMLElement>('[data-canvas-llm-result]')!.style.height).toBe('350px');
    await act(async () => buttons[0].click());
    expect(state.startWriting).toHaveBeenCalledWith('node');
  };
export const verifyAvailableVideoModel = async () => {
    state.models = { capabilityStatus: 'loaded', image: [], audio: [], chat: [], canvasDefault: { status: 'unavailable' }, video: [{ id: 'sora2', label: '可用视频模型', provider: 'test', category: 'video', supportedResolutions: ['720p'] }] };
    state.panel = true; await renderNode({ ...dataFor('videoTask'), model: 'retired-video' } as CanvasNodeData);
    const modelTrigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
    expect(modelTrigger).not.toBeNull(); expect(modelTrigger!.disabled).toBe(false);
    await act(async () => modelTrigger!.click());
    const option = [...document.body.querySelectorAll('[role="option"]')].find(item => item.textContent === '可用视频模型');
    expect(option).toBeDefined(); expect(option?.getAttribute('aria-disabled')).not.toBe('true');
  };
export const verifyPreviewNavigation = async (count: number) => {
    const items = Array.from({ length: count }, (_, i) => ({ id: String(i), kind: 'image' as const, url: `/uploads/${i}.png` }));
    await act(async () => root.render(React.createElement(CanvasMediaPreview, { items, onClose: vi.fn() })));
    const next = document.body.querySelector<HTMLButtonElement>('[aria-label="下一张"]');
    expect(Boolean(next)).toBe(count > 1);
    if (count > 1) { await act(async () => next!.click()); expect(document.body.querySelector('img')?.getAttribute('src')).toBe('/uploads/1.png'); expect(document.body.textContent).toContain('2 / 2'); }
    else expect(document.body.textContent).not.toContain('1 / 1');
    expect(document.body.querySelector('video[controls]')).toBeNull();
  };

export const verifyConnectedTextReference = async () => {
  state.panel = true;
  state.textReferences = [{ id: 'text-1', sourceNodeId: 'text-1', name: '人物', content: '' }];
  await renderNode(dataFor('imageTask'));
  let card = host.querySelector<HTMLElement>('[data-canvas-text-reference="text-1"]')!;
  expect(card).not.toBeNull();
  expect(card.querySelector('[data-canvas-reference-sequence]')?.textContent).toBe('1');
  await act(async () => card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(document.body.querySelector('[role=tooltip]')).toBeNull();
  state.textReferences = [{ ...state.textReferences[0], content: '人物保留' }];
  await renderNode(dataFor('imageTask'));
  card = host.querySelector<HTMLElement>('[data-canvas-text-reference="text-1"]')!;
  await act(async () => card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(document.body.querySelector('[role=tooltip]')?.textContent).toBe('人物保留');
  expect(card.hasAttribute('title')).toBe(false);
  expect(host.textContent).not.toContain('拖入参考素材');
  expect(card.querySelector('img')).toBeNull();
  await act(async () => card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(state.locate).toHaveBeenCalledWith('text-1');
  await act(async () => card.querySelector<HTMLButtonElement>('button')!.click());
  expect(state.removeReference).toHaveBeenCalledWith('node', 'text-1');
  state.textReferences = [{ ...state.textReferences[0], content: '保留背景' }];
  await renderNode(dataFor('imageTask'));
  card = host.querySelector<HTMLElement>('[data-canvas-text-reference="text-1"]')!;
  await act(async () => card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(document.body.querySelector('[role=tooltip]')?.textContent).toBe('保留背景');
  state.textReferences = [];
  await renderNode(dataFor('imageTask'));
  expect(host.querySelector('[data-canvas-text-reference]')).toBeNull();
  expect(host.querySelector('[data-canvas-task-assets]')?.children).toHaveLength(0);
};
