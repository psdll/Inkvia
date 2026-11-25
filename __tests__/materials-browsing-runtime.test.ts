import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const auth = vi.hoisted(() => ({ user: { id: 100, username: "browser" }, loading: false, openLoginModal: vi.fn() }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/components/settings/material-tools", () => ({ MaterialTools: () => null }));
import MaterialsPage from "@/app/materials/page";
let host: HTMLDivElement, root: Root, request: ReturnType<typeof vi.fn>;
let listeners: Map<string, (event: any) => void>[];
let chosen: boolean, added: boolean;
const items = Array.from({ length: 120 }, (_, i) => ({ id: 500-i, title: `Material ${500-i}`, imageUrl: `/m/${i}.jpg`, previewWidth: 800, previewHeight: 600, createdAt: "2026-09-01T00:00:00Z", isSelected: false }));
const state = () => ({ id: 500, isSelected: chosen, isSelectedByMe: false, selectedBy: chosen ? { id: 2, username: "其他用户", selectedAt: "2026-09-28T00:00:00Z" } : null });
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(100); }); };
const scroller = () => host.querySelector('[data-materials-scroll]') as HTMLElement || host.querySelector('[class*="overflow-y-auto"]') as HTMLElement;
const changed = async () => { await act(async () => { listeners.forEach(l => l.get('changed')?.({ data: '{}' })); }); await flush(); };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); auth.user = { id: auth.user.id + 1, username: "browser" };
  sessionStorage.clear(); localStorage.clear(); chosen = false; added = false; listeners = [];
  window.history.replaceState(null, '', '/materials');
  vi.stubGlobal("EventSource", class { l = new Map(); constructor() { listeners.push(this.l); } addEventListener(k: string, v: any) { this.l.set(k,v); } close() { this.l.clear(); } });
  vi.stubGlobal("ResizeObserver", class { constructor(public cb: () => void) {} observe() { this.cb(); } disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 1200, height: 900, top: 0, left: 0, right: 1200, bottom: 900, x: 0, y: 0, toJSON() {} }));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(20000);
  const srcSetter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!.set!;
  vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement, value: string) {
    srcSetter.call(this, value);
    // jsdom does not download native image preloads. Complete successful loads
    // just as the browser does so card-layout tests exercise the rendered image.
    queueMicrotask(() => { if (this.hasAttribute('src')) this.dispatchEvent(new Event('load')); });
  });
  request = vi.fn(async (raw: string, _init?: RequestInit) => {
    const url = new URL(String(raw), 'http://localhost');
    if (url.pathname.endsWith('/categories')) return Response.json({ categories: [], modelGroups: [] });
    if (url.pathname.endsWith('/selection-state')) return Response.json({ items: [state()] });
    if (url.pathname.endsWith('/select')) return Response.json({ error: "该素材已被其他用户挑选", selectedBy: state().selectedBy }, { status: 409 });
    if (url.pathname === '/api/material-assets') {
      if (url.searchParams.get('view') === 'summary') return Response.json({ total: 120, stats: { total: 120, selected: chosen ? 1 : 0, available: 119, unselected: 119 } });
      const page = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('pageSize') || 60);
      const list = added ? [{ ...items[0], id: 600, title: '新素材' }, ...items] : items;
      return Response.json({ items: list.slice((page-1)*size, page*size).map(x => x.id === 500 ? { ...x, ...state() } : x), pagination: { page, pageSize: size, total: list.length, totalPages: Math.ceil(list.length/size), hasMore: page*size < list.length, nextCursor: `cursor-${page}` }, stats: { total: list.length, selected: 0, available: list.length, unselected: list.length } });
    }
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', request);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const mount = async () => { await act(async () => root.render(React.createElement(MaterialsPage))); await flush(); };

it('defaults to all materials despite the previous available default and searches all history', async () => {
  localStorage.setItem('materials_status_filter_v2', 'available');
  await mount();
  expect(request.mock.calls.some(([url]) => String(url).includes('view=cards') && String(url).includes('status=all'))).toBe(true);
  const input = host.querySelector('input[placeholder="搜索标题、标签、分类"]')!;
  await act(async () => Simulate.change(input, { target: { value: 'old' } } as any));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(request.mock.calls.some(([url]) => String(url).includes('q=old') && String(url).includes('status=all'))).toBe(true);
});

it.each([['archived','mine'],['available_archived','available']])('maps the old %s bookmark to %s', async (oldStatus, next) => {
  window.history.replaceState(null, '', `/materials?status=${oldStatus}`);
  await mount();
  expect(request.mock.calls.some(([url]) => String(url).includes('view=cards') && String(url).includes(`status=${next}`))).toBe(true);
});

it('does not report no materials while a search is pending or has failed', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => String(raw).includes('view=cards') ? Promise.resolve(Response.json({ items: [], pagination: { page: 1, hasMore: false } })) : original(raw));
  await mount();
  expect(host.textContent).toContain('没有找到素材');
  let reject: ((e: Error) => void) | undefined;
  request.mockImplementation(raw => String(raw).includes('view=cards') ? new Promise((_resolve, fail) => { reject = fail; }) : original(raw));
  await act(async () => Simulate.change(host.querySelector('input[placeholder="搜索标题、标签、分类"]')!, { target: { value: 'old' } } as any));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(reject).toBeDefined();
  expect(host.textContent).not.toContain('没有找到素材');
  await act(async () => reject!(new Error('网络失败'))); await flush();
  expect(host.textContent).not.toContain('没有找到素材');
  expect(host.textContent).toContain('重试加载');
});

it('updates counts for a new search after its cards finish loading', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => {
    const url = new URL(String(raw), 'http://localhost');
    if (url.searchParams.has('q') && url.searchParams.get('view') === 'cards') return Promise.resolve(Response.json({ items: [items[0]], pagination: { page: 1, hasMore: false } }));
    if (url.searchParams.has('q') && url.searchParams.get('view') === 'summary') return Promise.resolve(Response.json({ total: 1, stats: { total: 1, selected: 0, available: 1, unselected: 1 } }));
    return original(raw);
  });
  await mount();
  await act(async () => Simulate.change(host.querySelector('input[placeholder="搜索标题、标签、分类"]')!, { target: { value: 'old' } } as any));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(host.textContent).toContain('已加载全部 1 个素材');
  expect(host.textContent).not.toContain('已加载全部 120 个素材');
});

it('requests lightweight cards and restores scroll and all loaded pages on return', async () => {
  await mount();
  expect(request.mock.calls.some(([url]) => String(url).includes('view=cards'))).toBe(true);
  const area = scroller(); let top = 0;
  Object.defineProperty(area, 'scrollTop', { configurable: true, get() { return this.isConnected ? top : 0; }, set(value) { top = value; } });
  area.scrollTop = 18800;
  await act(async () => area.dispatchEvent(new Event('scroll'))); await flush();
  const calls = request.mock.calls.filter(([u]) => String(u).includes('view=cards')).length;
  await act(async () => root.render(null)); await mount();
  expect(scroller().scrollTop).toBe(18800);
  // Entry status checks may request a head page; appending pages must be restored.
  expect(request.mock.calls.filter(([u]) => String(u).includes('page=2')).length).toBe(1);
  expect(calls).toBeGreaterThan(1);
});
it('patches another user selection without moving cards, including after remount', async () => {
  window.history.replaceState(null, '', '/materials?status=all');
  await mount(); const area = scroller(); area.scrollTop = 600;
  const before = [...host.querySelectorAll('article')].map(n => n.parentElement!.getAttribute('style'));
  chosen = true; await changed();
  expect(host.textContent).toContain('已被选中');
  expect(area.scrollTop).toBe(600);
  expect([...host.querySelectorAll('article')].map(n => n.parentElement!.getAttribute('style'))).toEqual(before);
  await act(async () => root.render(null)); await mount();
  expect(host.textContent).toContain('已被选中');
});
it('keeps a newly selected card in place while browsing, but removes it from available on return', async () => {
  window.history.replaceState(null, '', '/materials?status=available');
  await mount();
  chosen = true; await changed();
  expect(host.querySelector('button[aria-label="Material 500"]')).not.toBeNull();
  await act(async () => root.render(null)); await mount();
  expect(host.querySelector('button[aria-label="Material 500"]')).toBeNull();
  expect(host.querySelector('button[aria-label="Material 499"]')).not.toBeNull();
});
it('announces newly uploaded materials without replacing the currently browsed list', async () => {
  await mount(); scroller().scrollTop = 600;
  added = true; await changed();
  expect(host.textContent).toContain('有新素材');
  expect(scroller().scrollTop).toBe(600);
});
it('uses the conflict response immediately instead of restoring stale available cache', async () => {
  window.history.replaceState(null, '', '/materials?status=available');
  await mount(); chosen = true;
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === '挑选')!;
  await act(async () => Simulate.click(button)); await flush();
  expect(host.textContent).toContain('已被选中');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '不可选' && b.disabled)).toBe(true);
});

it('keeps legacy card geometry stable when decoding and selection arrive together', async () => {
  const original = { width: items[0].previewWidth, height: items[0].previewHeight };
  items[0].previewWidth = 0; items[0].previewHeight = 0;
  try {
    await mount();
    const before = [...host.querySelectorAll('article')].map(n => n.parentElement!.getAttribute('style'));
    const image = host.querySelector('article img')!;
    Object.defineProperty(image, 'naturalWidth', { value: 600, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: 1200, configurable: true });
    await act(async () => Simulate.load(image));
    chosen = true; await changed();
    expect([...host.querySelectorAll('article')].map(n => n.parentElement!.getAttribute('style'))).toEqual(before);
  } finally { items[0].previewWidth = original.width; items[0].previewHeight = original.height; }
});
it.each([600, 1200])('loads the 1200px source or prepared preview when the existing thumbnail is %spx wide', async width => {
  const item = items[0] as any;
  const original = { imageUrl: item.imageUrl, thumbnailUrl: item.thumbnailUrl, mediaItems: item.mediaItems };
  item.imageUrl = '/uploads/materials/original.png';
  item.thumbnailUrl = `/uploads/materials/thumbs/card-${width}.webp`;
  item.mediaItems = [{ width, height: width * 4 / 3 }];
  try {
    await mount(); await flush();
    const src = host.querySelector('article img')?.getAttribute('src');
    if (width === 1200) expect(src).toBe(item.thumbnailUrl);
    else {
      expect(src).toBe('/api/thumb?src=%2Fuploads%2Fmaterials%2Foriginal.png&w=1200');
      expect(src).not.toContain('card-600.webp');
    }
  } finally { Object.assign(item, original); }
});
it('keeps a nearly level monthly final row left aligned instead of leaving an interior empty slot', async () => {
  window.history.replaceState(null, '', '/materials?status=mine');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1900, height: 900, top: 0, left: 0, right: 1900, bottom: 900, x: 0, y: 0, toJSON() {} });
  const monthlyItems = items.slice(0, 20).map((item, index) => ({ ...item, previewWidth: 600, previewHeight: index < 3 ? 804 : 800, isSelected: true, isSelectedByMe: true }));
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => String(raw).includes('view=cards')
    ? Promise.resolve(Response.json({ items: monthlyItems, pagination: { page: 1, hasMore: false } }))
    : original(raw));
  await mount();
  const positions = monthlyItems.map(item => {
    const card = host.querySelector(`[data-material-id="${item.id}"]`) as HTMLElement;
    expect(card).not.toBeNull();
    return Number.parseFloat(card.parentElement!.style.left);
  });
  expect(positions.slice(14)).toEqual(positions.slice(0, 6));
});

it('loads a missing-poster video frame only when the material card becomes visible', async () => {
  let notifyVisible: () => void = () => {};
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      notifyVisible = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect() {}
  });
  const entry = items[12] as any;
  const original = entry.imageUrl;
  entry.imageUrl = '/missing-poster.mp4'; entry.mimeType = 'video/mp4';
  try {
    await mount(); await flush();
    expect(host.querySelectorAll('video')).toHaveLength(0);
    expect(request.mock.calls.some(([url]) => String(url).includes('missing-poster.mp4'))).toBe(false);
    await act(async () => notifyVisible());
    expect(host.querySelector('video')?.getAttribute('src')).toBe('/missing-poster.mp4#t=0.1');
    expect(host.querySelector('video')?.autoplay).toBe(false);
  } finally { entry.imageUrl = original; delete entry.mimeType; }
});
it('does not let an older status response undo a successful selection', async () => {
  await mount();
  const original = request.getMockImplementation()!;
  let deliver: ((response: Response) => void) | undefined;
  request.mockImplementation((raw: string) => {
    if (raw.includes('/selection-state')) return new Promise<Response>(resolve => { deliver = resolve; });
    if (raw.endsWith('/select')) return Promise.resolve(Response.json({ item: { selectedBy: { id: auth.user.id, username: auth.user.username, selectedAt: '2026-09-28T00:00:00Z' } } }));
    return original(raw);
  });
  await changed();
  expect(deliver).toBeDefined();
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === '挑选')!;
  await act(async () => Simulate.click(button)); await flush();
  expect(host.textContent).toContain('我已挑选');
  await act(async () => deliver!(Response.json({ items: [{ id: 500, isSelected: false, isSelectedByMe: false, selectedBy: null }] })));
  await flush();
  expect(host.textContent).toContain('我已挑选');
});

it('shows new uploads at the top even after several pages were already prefetched', async () => {
  await mount(); scroller().scrollTop = 18800;
  await act(async () => scroller().dispatchEvent(new Event('scroll'))); await flush();
  scroller().scrollTop = 0;
  added = true; await changed();
  expect(host.querySelector('button[aria-label="新素材"]')).not.toBeNull();
});

it('discards an old pagination response after a new upload replaces the head', async () => {
  await mount();
  const original = request.getMockImplementation()!;
  let deliver: ((response: Response) => void) | undefined;
  request.mockImplementation((raw: string) => {
    if (raw.includes('view=cards') && raw.includes('page=2')) return new Promise<Response>(resolve => { deliver = resolve; });
    return original(raw);
  });
  scroller().scrollTop = 18800;
  await act(async () => scroller().dispatchEvent(new Event('scroll'))); await flush();
  expect(deliver).toBeDefined();
  scroller().scrollTop = 0;
  await act(async () => scroller().dispatchEvent(new Event('scroll'))); await flush();
  added = true; await changed();
  await act(async () => deliver!(Response.json({ items: [{ ...items[0], id: 777, title: '过期分页' }], pagination: { page: 2, hasMore: false } })));
  await flush();
  await act(async () => root.render(null));
  const stored = Object.keys(sessionStorage).map(key => sessionStorage.getItem(key)).join('');
  expect(stored).toContain('新素材');
  expect(stored).not.toContain('过期分页');
});

it('keeps mounted material cards bounded while scrolling through a 1200 item catalogue', async () => {
  const catalogue = Array.from({ length: 1200 }, (_, i) => ({ ...items[0], id: 10000 - i, title: `Large ${i}`, imageUrl: `/large/${i}.webp` }));
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => {
    const url = new URL(String(raw), 'http://localhost');
    if (url.pathname === '/api/material-assets' && url.searchParams.get('view') === 'cards') {
      return Promise.resolve(Response.json({ items: catalogue, pagination: { page: 1, pageSize: 1200, total: 1200, hasMore: false } }));
    }
    return original(raw);
  });
  await mount();
  for (const top of [0, 5000, 10000, 15000, 20000, 0]) {
    scroller().scrollTop = top;
    await act(async () => scroller().dispatchEvent(new Event('scroll'))); await flush();
    const count = host.querySelectorAll('article').length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(120);
    expect(host.textContent).not.toContain('没有找到素材');
  }
});

it('prepares further ahead during fast scrolling and reverses that buffer when scrolling back', async () => {
  const catalogue = Array.from({ length: 300 }, (_, i) => ({ ...items[0], id: 15000 - i, title: `Ahead ${i}`, imageUrl: `/ahead/${i}.webp` }));
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => String(raw).includes('view=cards')
    ? Promise.resolve(Response.json({ items: catalogue, pagination: { page: 1, hasMore: false } }))
    : original(raw));
  await mount();
  const move = async (top: number) => {
    scroller().scrollTop = top;
    await act(async () => scroller().dispatchEvent(new Event('scroll'))); await flush();
    return [...host.querySelectorAll('article')].filter(card => card.querySelector('img'))
      .map(card => Number.parseFloat((card.parentElement as HTMLElement).style.top));
  };
  await move(1000);
  const forward = await move(5000);
  expect(Math.max(...forward)).toBeGreaterThan(5000 + 900 + 1800);
  await move(10000);
  const backward = await move(5000);
  expect(Math.min(...backward)).toBeLessThan(5000 - 1800);
  expect(host.querySelectorAll('article').length).toBeLessThan(120);
});

it('only reconciles the current render window after loading 10000 materials', async () => {
  const catalogue = Array.from({ length: 10000 }, (_, i) => ({ ...items[0], id: 20000 - i, title: `Scale ${i}`, imageUrl: `/scale/${i}.webp` }));
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => {
    const url = new URL(String(raw), 'http://localhost');
    if (url.pathname === '/api/material-assets' && url.searchParams.get('view') === 'cards') return Promise.resolve(Response.json({ items: catalogue, pagination: { page: 1, pageSize: 60, total: 10000, hasMore: false } }));
    return original(raw);
  });
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(250));
  request.mockClear();
  await changed();
  let checks = request.mock.calls.filter(([url]) => String(url).includes('/selection-state'));
  expect(checks.length).toBeLessThanOrEqual(1);
  expect(checks.length).toBeGreaterThan(0);
  for (const [url] of checks) expect(new URL(String(url), 'http://localhost').searchParams.get('ids')!.split(',').length).toBeLessThanOrEqual(200);
  const firstIds = new URL(String(checks[0][0]), 'http://localhost').searchParams.get('ids');
  request.mockClear();
  scroller().scrollTop = 20000;
  await act(async () => scroller().dispatchEvent(new Event('scroll')));
  await flush();
  await act(async () => vi.advanceTimersByTimeAsync(400));
  checks = request.mock.calls.filter(([url]) => String(url).includes('/selection-state'));
  expect(checks.length).toBe(1);
  expect(new URL(String(checks[0][0]), 'http://localhost').searchParams.get('ids')).not.toBe(firstIds);
  expect(host.querySelectorAll('article').length).toBeLessThan(120);
});

it('hides empty categories and returns to all when the selected unclassified category becomes empty', async () => {
  let hasUngrouped = false;
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => String(raw).includes('/categories')
    ? Promise.resolve(Response.json({ categories: ['按摩椅'], modelGroups: [], hasUngrouped }))
    : original(raw));
  await mount();
  const categoryButtons = () => [...host.querySelectorAll('button')].filter(button => button.textContent?.trim() === '未分类');
  expect(categoryButtons()).toHaveLength(0);
  hasUngrouped = true;
  await act(async () => { window.dispatchEvent(new Event('materials:refresh')); });
  await flush();
  expect(categoryButtons().length).toBeGreaterThan(0);
  await act(async () => categoryButtons().at(-1)!.click());
  await flush();
  hasUngrouped = false;
  await act(async () => { window.dispatchEvent(new Event('materials:refresh')); });
  await flush();
  expect(categoryButtons()).toHaveLength(0);
  const lastCardsRequest = request.mock.calls.map(([url]) => new URL(String(url), 'http://localhost')).filter(url => url.searchParams.get('view') === 'cards').at(-1)!;
  expect(lastCardsRequest.searchParams.get('category')).not.toBe('ungrouped');
});

it('submits a rapid double click on one material only once', async () => {
  await mount();
  const original = request.getMockImplementation()!;
  let finish: ((response: Response) => void) | undefined;
  request.mockImplementation(raw => raw.endsWith('/select') ? new Promise<Response>(resolve => { finish = resolve; }) : original(raw));
  const choose = [...host.querySelectorAll('button')].find(button => button.textContent === '挑选')!;
  await act(async () => { Simulate.click(choose); Simulate.click(choose); });
  expect(request.mock.calls.filter(([url]) => url.endsWith('/select'))).toHaveLength(1);
  await act(async () => finish!(Response.json({ item: { selectedBy: { id: auth.user.id, username: auth.user.username } } })));
});

it('reconciles a selection whose response failed after the server accepted it', async () => {
  await mount();
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => {
    if (raw.endsWith('/select')) { chosen = true; return Promise.reject(new Error('连接中断')); }
    return original(raw);
  });
  const choose = [...host.querySelectorAll('button')].find(button => button.textContent === '挑选')!;
  await act(async () => Simulate.click(choose));
  await flush();
  expect(host.textContent).toContain('已被选中');
  expect(host.querySelector('article')?.textContent).not.toContain('可挑选');
});

it('keeps separate materials busy until each selection finishes', async () => {
  await mount();
  const original = request.getMockImplementation()!;
  const finish: Array<(response: Response) => void> = [];
  request.mockImplementation(raw => raw.endsWith('/select') ? new Promise<Response>(resolve => finish.push(resolve)) : original(raw));
  const choose = [...host.querySelectorAll<HTMLButtonElement>('article button')].filter(button => button.textContent === '挑选');
  await act(async () => { Simulate.click(choose[0]); Simulate.click(choose[1]); });
  expect(choose[0].disabled).toBe(true);
  expect(choose[1].disabled).toBe(true);
  await act(async () => finish[0](Response.json({ item: { selectedBy: { id: auth.user.id, username: auth.user.username } } })));
  expect(choose[1].disabled).toBe(true);
  await act(async () => finish[1](Response.json({ item: { selectedBy: { id: auth.user.id, username: auth.user.username } } })));
});

it('keeps the viewed series image when background selection state changes', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => raw === '/api/material-assets/500' ? Promise.resolve(Response.json({ item: {
    ...items[0], mediaItems: [
      { id: 'one', originalUrl: '/series-one.png' }, { id: 'two', originalUrl: '/series-two.png' },
    ], mediaCount: 2,
  } })) : original(raw));
  await mount();
  await act(async () => Simulate.click(host.querySelector('button[aria-label="Material 500"]')!));
  await act(async () => Simulate.click(host.querySelector('button[aria-label="下一张"]')!));
  const originalImage = () => [...host.querySelectorAll<HTMLImageElement>('img')].find(img => img.getAttribute('src') === '/series-two.png');
  expect(originalImage()).toBeDefined();
  chosen = true;
  const withDetail = request.getMockImplementation()!;
  request.mockImplementation(raw => raw.includes('/selection-state')
    ? Promise.resolve(Response.json({ items: [{ ...state(), selectedMediaId: 'one' }] })) : withDetail(raw));
  await changed();
  expect(host.textContent).toContain('已被选中');
  expect(originalImage()).toBeDefined();
});

it('retries a failed detail image and shows an actionable close control instead of a broken image', async () => {
  await mount();
  await act(async () => Simulate.click(host.querySelector('button[aria-label="Material 500"]')!));
  const image = host.querySelector<HTMLImageElement>('img.pointer-events-none')!;
  expect(image).toBeDefined();
  await act(async () => Simulate.error(image));
  expect(image.getAttribute('src')).toContain('_r=1');
  await act(async () => Simulate.error(image));
  expect(host.textContent).toContain('预览加载失败');
  await act(async () => Simulate.click(host.querySelector('button[aria-label="关闭素材详情"]')!));
  expect(host.querySelector('button[aria-label="关闭素材详情"]')).toBeNull();
});

it('does not let a delayed detail response undo a completed selection', async () => {
  await mount();
  const original = request.getMockImplementation()!;
  let finishDetail: ((response: Response) => void) | undefined;
  request.mockImplementation(raw => {
    if (raw === '/api/material-assets/500') return new Promise<Response>(resolve => { finishDetail = resolve; });
    if (raw.endsWith('/select')) return Promise.resolve(Response.json({ item: { selectedBy: { id: auth.user.id, username: auth.user.username } } }));
    return original(raw);
  });
  await act(async () => Simulate.click(host.querySelector('button[aria-label="Material 500"]')!));
  const choose = [...host.querySelectorAll('button')].find(button => button.textContent === '挑选')!;
  await act(async () => Simulate.click(choose));
  expect(host.textContent).toContain('我已挑选');
  await act(async () => finishDetail!(Response.json({ item: { ...items[0], isSelected: false, isSelectedByMe: false, selectedBy: null } })));
  expect(host.textContent).toContain('我已挑选');
});

it('serializes changing status windows without cancelling extension-wrapped fetch', async () => {
  const initial = request.getMockImplementation()!;
  request.mockImplementation(raw => raw.includes('view=cards')
    ? Promise.resolve(Response.json({ items, pagination: { page: 1, hasMore: false } })) : initial(raw));
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const original = request.getMockImplementation()!;
  let finish: ((response: Response) => void) | undefined;
  request.mockImplementation(raw => raw.includes('/selection-state')
    ? new Promise<Response>(resolve => { finish = resolve; }) : original(raw));
  request.mockClear();
  await changed();
  const pending = finish!;
  scroller().scrollTop = 4000;
  await act(async () => scroller().dispatchEvent(new Event('scroll')));
  await flush();
  await act(async () => vi.advanceTimersByTimeAsync(400));
  let checks = request.mock.calls.filter(([url]) => url.includes('/selection-state'));
  expect(checks).toHaveLength(1);
  expect(checks[0][1]?.signal).toBeUndefined();
  await act(async () => pending(Response.json({ items: [] })));
  await flush();
  checks = request.mock.calls.filter(([url]) => url.includes('/selection-state'));
  expect(checks).toHaveLength(2);
  expect(checks[1][1]?.signal).toBeUndefined();
  await act(async () => finish!(Response.json({ items: [] })));
});
