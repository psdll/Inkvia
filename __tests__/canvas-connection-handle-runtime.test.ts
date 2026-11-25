import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@xyflow/react', () => ({
  Position: { Left: 'left', Right: 'right' }, useNodeId: () => 'material',
  Handle: ({ children, id, type, position, isConnectableStart, isConnectableEnd }: any) => React.createElement('div', {
    'data-id': id, 'data-type': type, 'data-position': position,
    'data-start': String(isConnectableStart), 'data-end': String(isConnectableEnd),
  }, children),
}));
import { CanvasConnectionHandle, CanvasConnectionHandleClickContext } from '@/components/canvas/CanvasConnectionHandle';
let root: Root, host: HTMLDivElement, now: number;
const open = vi.fn(), bubble = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
  open.mockReset(); bubble.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(type: 'source' | 'target' = 'source', acceptsInput = true, compact = false) {
  act(() => root.render(React.createElement(CanvasConnectionHandleClickContext.Provider, { value: open },
    React.createElement('div', { onClick: bubble }, React.createElement(CanvasConnectionHandle, { type, acceptsInput, compact, connectionInProgress: false })))));
  return host.querySelector<HTMLElement>('[data-type="source"] [data-canvas-connection-handle-hit-area]')!;
}
it('keeps a left outgoing connector for uploaded material without adding an input target', () => {
  mount('target', false);
  expect(host.querySelector('[data-type="target"]')).toBeNull();
  expect(host.querySelector('[data-type="source"]')?.getAttribute('data-id')).toBe('canvas-left-output');
  expect(host.querySelector('[data-type="source"]')?.getAttribute('data-start')).toBe('true');
  expect(host.querySelector('[data-type="source"]')?.getAttribute('data-end')).toBe('false');
});
it.each([[299, 9, 1], [300, 0, 0], [20, 10, 0]])('distinguishes a short click from a long press or drag (%sms, %spx)', (duration, distance, calls) => {
  const hit = mount('target', false);
  act(() => hit.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 20 })));
  now = duration;
  act(() => hit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10 + distance, clientY: 20 })));
  expect(open).toHaveBeenCalledTimes(calls);
  if (calls) expect(open).toHaveBeenCalledWith({ nodeId: 'material', handleId: 'canvas-left-output', position: 'left', point: { x: 19, y: 20 } });
  expect(bubble).not.toHaveBeenCalled();
});
it('does not open a menu after pointer cancellation', () => {
  const hit = mount();
  act(() => {
    hit.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    hit.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(open).not.toHaveBeenCalled();
});
it('keeps overview connection handles and quick menus with no per-handle SVG tree', () => {
  const hit = mount('target', true, true);
  expect(host.querySelectorAll('[data-type="source"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-type="target"]')).toHaveLength(1);
  expect(host.querySelectorAll('svg')).toHaveLength(0);
  act(() => {
    hit.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(open).toHaveBeenCalledTimes(1);
  expect(bubble).not.toHaveBeenCalled();
});
it('preserves magnetic following and reset for full-detail handles', () => {
  const hit = mount('source');
  const visual = hit.querySelector('svg')!;
  const resting = visual.style.transform;
  act(() => hit.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 10 })));
  expect(visual.style.transform).toBe('translate(20px, 10px) scale(1.1)');
  act(() => hit.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
  expect(visual.style.transform).toBe(resting);
});
