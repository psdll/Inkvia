import { expect } from 'vitest';
import { createMarqueeIndex, createMarqueeFrame } from '@/lib/canvas/marquee-selection';
import { resolveCanvasMarqueeSelection } from '@/lib/canvas/graph';
import { resolveCanvasShortcut } from '@/lib/canvas/shortcuts';

export function verifyMarqueeOverlap() {
  const search = createMarqueeIndex([
    { id: 'a', x: 10, y: 10, width: 100, height: 100 },
    { id: 'hidden', x: 10, y: 10, width: 100, height: 100, hidden: true },
    { id: 'locked', x: 10, y: 10, width: 100, height: 100, selectable: false },
    { id: 'b', x: 210, y: 10, width: 100, height: 100 },
  ]);
  expect(search({ x: 0, y: 0, width: 11, height: 11 })).toEqual(['a']);
  expect(search({ x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
  expect(search({ x: 0, y: 0, width: 220, height: 20 })).toEqual(['a', 'b']);
}

export function verifyMarqueeModifiersAndCancel() {
  expect(resolveCanvasMarqueeSelection(['a', 'b'], ['b', 'c', 'c'], 'replace')).toEqual(['b', 'c']);
  expect(resolveCanvasMarqueeSelection(['a', 'b'], ['b', 'c'], 'union')).toEqual(['a', 'b', 'c']);
  expect(resolveCanvasMarqueeSelection(['a', 'b'], ['b', 'c'], 'toggle')).toEqual(['a', 'c']);
  const published: string[][] = []; const scheduled = new Map<number, () => void>();
  const frame = createMarqueeFrame<string[]>(ids => published.push(ids), cb => { scheduled.set(1, cb); return 1; }, id => { scheduled.delete(id); });
  frame.push(['a']); frame.push(['b']); frame.cancel();
  for (const callback of scheduled.values()) callback();
  expect(published).toEqual([]);
  frame.push(['c']); frame.flush(); expect(published).toEqual([['c']]);
}

export function verifyKeyboardCommands() {
  const event = { key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  for (const [key, command] of [['g', 'group'], ['d', 'duplicate'], ['z', 'undo'], ['Enter', 'generate']]) {
    expect(resolveCanvasShortcut({ ...event, key, ctrlKey: true })).toBe(command);
    expect(resolveCanvasShortcut({ ...event, key, metaKey: true })).toBe(command);
  }
  expect(resolveCanvasShortcut({ ...event, key: 'g', ctrlKey: true, shiftKey: true })).toBe('ungroup');
  expect(resolveCanvasShortcut({ ...event, key: 'f', altKey: true, shiftKey: true })).toBe('arrange');
  for (const key of ['Delete', 'Backspace']) expect(resolveCanvasShortcut({ ...event, key })).toBe('delete');
  expect(resolveCanvasShortcut({ ...event, key: 'Tab' })).toBe('create');
  expect(resolveCanvasShortcut({ ...event, key: 'z', ctrlKey: true, shiftKey: true })).toBe('redo');
  expect(resolveCanvasShortcut({ ...event, key: 'z', metaKey: true, shiftKey: true })).toBe('redo');
  expect(resolveCanvasShortcut({ ...event, key: 'd', altKey: true, ctrlKey: true })).toBeNull();
}
