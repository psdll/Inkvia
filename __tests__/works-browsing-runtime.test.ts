/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: 700, username: "works-test" }, loading: false }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-logger", () => ({ useLogger: () => ({ logAction: () => {} }) }));
vi.mock("@/components/ui/auto-hide-scrollbar", () => ({ AutoHideScrollbar: () => null }));
vi.mock("@/components/ui/scroll-to-top-button", () => ({ ScrollToTopButton: () => null }));
vi.mock("@/components/works/work-detail-modal", () => ({ WorkDetailModal: ({ open, item }: any) => open ? React.createElement('div', { 'data-detail': true }, JSON.stringify(item)) : null }));
// JSDOM has no layout. Exercise the real page/controller with rows rendered deterministically.
vi.mock("react-virtuoso", () => ({ Virtuoso: React.forwardRef(function MockVirtuoso({ data, itemContent, context, components }: any, ref) {
  React.useImperativeHandle(ref, () => ({ getState: (cb: any) => cb({ ranges: [], scrollTop: 0 }) }));
  return React.createElement('div', null, data.map((row: any, i: number) => React.createElement('div', { key: row.key }, itemContent(i, row))), React.createElement(components.Footer, { context }));
}) }));
import WorksPage from "@/app/works/page";
import { warmWorksEntry, takeWorksEntry, clearWorksEntry } from "@/lib/client/works-entry";

let host: HTMLDivElement, root: Root, request: ReturnType<typeof vi.fn>;
let releaseCount: (r: Response) => void;
const cards = Array.from({ length: 60 }, (_, i) => ({ id: 600-i, type: 'image_edit', status: 'success', prompt: `作品 ${i}`, localPath: `/uploads/full-${i}.png`, thumbUrl: `/uploads/thumb-${i}.webp`, displayUrl: `/uploads/preview-${i}.webp`, createdAt: '2026-09-28T01:00:00Z', outputPaths: [`/uploads/full-${i}.png`], detailPending: true }));
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(50); }); };
const mount = async () => { await act(async () => root.render(React.createElement(WorksPage))); await flush(); };
const scroller = () => host.querySelector('#works-asset-list') as HTMLElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  auth.user = { ...auth.user, id: auth.user.id + 1 }; sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { constructor(public cb: () => void) {} observe() { this.cb(); } disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(15000);
  HTMLElement.prototype.scrollTo = function(options: any) { this.scrollTop = options.top || 0; };
  request = vi.fn(async (raw: string, _init?: RequestInit) => {
    const url = new URL(String(raw), 'http://localhost');
    if (url.pathname === '/api/assets') {
      if (url.searchParams.has('detailId')) return Response.json({ item: { ...cards[0], detailPending: false, params: { seed: 42 }, inputImages: ['/uploads/reference.png'] } });
      if (url.searchParams.has('count')) return new Promise<Response>(r => { releaseCount = r; });
      return Response.json({ items: url.searchParams.has('cursor') ? [{ ...cards[0], id: 500 }] : cards, nextCursor: url.searchParams.has('cursor') ? null : 'page-2', hasMore: !url.searchParams.has('cursor') });
    }
    return Response.json({ allowed: false });
  });
  vi.stubGlobal('fetch', request);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); clearWorksEntry(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('switches filters and unmounts without aborting requests observed by browser inspectors', async () => {
  const original = request.getMockImplementation()!;
  const inspectorError = vi.fn();
  request.mockImplementation((raw, init) => {
    init?.signal?.addEventListener('abort', inspectorError);
    return original(raw, init);
  });
  await mount();
  await act(async () => Simulate.click([...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('视频'))!));
  await flush();
  await act(async () => root.render(null));
  expect(inspectorError).not.toHaveBeenCalled();
});

it('clears idle entry state without aborting an extension response clone', async () => {
  const original = request.getMockImplementation()!;
  const inspectorError = vi.fn();
  request.mockImplementation((raw, init) => {
    init?.signal?.addEventListener('abort', inspectorError);
    return original(raw, init);
  });
  warmWorksEntry(String(auth.user.id));
  clearWorksEntry();
  expect(inspectorError).not.toHaveBeenCalled();
});

it('shows usable cards while count is pending, and keeps them if count fails', async () => {
  await mount();
  expect(host.querySelectorAll('button[aria-label="查看资产详情"]').length).toBeGreaterThan(0);
  await act(async () => releaseCount(Response.json({ error: 'count unavailable' }, { status: 500 })));
  expect(host.textContent).not.toContain('count unavailable');
  expect(host.querySelectorAll('button[aria-label="查看资产详情"]').length).toBeGreaterThan(0);
});

it('uses card thumbnails and requests the next page several screens before the end', async () => {
  await mount(); await act(async () => releaseCount(Response.json({ total: 61 }))); await flush();
  expect(host.querySelector('img')?.getAttribute('src')).toBe('/uploads/thumb-0.webp');
  const area = scroller(); area.scrollTop = 12000;
  await act(async () => Simulate.scroll(area)); await flush();
  expect(request.mock.calls.some(([url]) => String(url).includes('cursor=page-2'))).toBe(true);
});

it('restores the loaded pages and scroll position on return', async () => {
  await mount(); await act(async () => releaseCount(Response.json({ total: 61 }))); await flush();
  const area = scroller(); area.scrollTop = 14300;
  await act(async () => Simulate.scroll(area)); await flush();
  const pages = request.mock.calls.filter(([url]) => String(url).includes('cursor=page-2')).length;
  await act(async () => root.render(null)); await mount();
  expect(scroller().scrollTop).toBe(14300);
  expect(request.mock.calls.filter(([url]) => String(url).includes('cursor=page-2')).length).toBe(pages);
});

it('hydrates full details on opening a lightweight card', async () => {
  await mount(); await act(async () => releaseCount(Response.json({ total: 60 }))); await flush();
  await act(async () => Simulate.click(host.querySelector('button[aria-label="查看资产详情"]')!)); await flush();
  expect(host.querySelector('[data-detail]')?.textContent).toContain('reference.png');
  expect(host.querySelector('[data-detail]')?.textContent).toContain('"seed":42');
});

it('keeps visible assets and the tail cursor when refreshing the head', async () => {
  await mount(); await act(async () => releaseCount(Response.json({ total: 61 }))); await flush();
  scroller().scrollTop = 14300;
  await act(async () => Simulate.scroll(scroller())); await flush();
  scroller().scrollTop = 800;
  await act(async () => Simulate.scroll(scroller()));
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => String(raw).includes('/api/assets') && !String(raw).includes('count=') ? Promise.resolve(Response.json({ items: [{ ...cards[0], id: 800 }], nextCursor: 'head-cursor', hasMore: true })) : original(raw));
  await act(async () => window.dispatchEvent(new Event('works:refresh'))); await flush();
  expect(host.textContent).toContain('有 1 个新资产');
  expect(scroller().scrollTop).toBe(800);
  expect(host.querySelectorAll('button[aria-label="查看资产详情"]').length).toBe(61);
  expect(request.mock.calls.some(([url]) => String(url).includes('cursor=head-cursor'))).toBe(false);
});

it('discards an old page after changing filters while it is in flight', async () => {
  const original = request.getMockImplementation()!;
  let release: (r: Response) => void = () => {};
  request.mockImplementation(raw => String(raw).includes('cursor=page-2') ? new Promise<Response>(r => { release = r; }) : original(raw));
  await mount(); await act(async () => releaseCount(Response.json({ total: 61 }))); await flush();
  await act(async () => Simulate.click([...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('视频'))!));
  await flush();
  await act(async () => release(Response.json({ items: [{ ...cards[0], id: 99, localPath: '/uploads/stale.png' }], hasMore: false })));
  expect(host.innerHTML).not.toContain('stale.png');
});

it('defers missing-poster video frames until the asset becomes visible', async () => {
  let notifyVisible: () => void = () => {};
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      notifyVisible = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect() {}
  });
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => String(raw).includes('/api/assets') && !String(raw).includes('count=') ? Promise.resolve(Response.json({ items: [{ ...cards[0], type: 'video_gen', displayKind: 'video', localPath: '/uploads/old.mp4', displayUrl: '/uploads/old.mp4', thumbUrl: '/uploads/old.mp4' }], hasMore: false })) : original(raw));
  await mount();
  expect(host.querySelectorAll('video')).toHaveLength(0);
  expect(request.mock.calls.some(([url]) => String(url).includes('old.mp4'))).toBe(false);
  await act(async () => notifyVisible());
  expect(host.querySelector('video')?.getAttribute('src')).toBe('/uploads/old.mp4#t=0.1');
  expect(host.querySelector('video')?.autoplay).toBe(false);
});

it('clears the visible gallery when the account changes, before the new request finishes', async () => {
  await mount();
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => String(raw).includes('/api/assets') ? new Promise<Response>(() => {}) : original(raw));
  auth.user = { ...auth.user, id: auth.user.id + 1000 };
  await act(async () => root.render(React.createElement(WorksPage))); await flush();
  expect(host.querySelectorAll('button[aria-label="查看资产详情"]')).toHaveLength(0);
  expect(host.textContent).not.toContain('暂无资产');
});

it('consumes the idle entry request without requesting the same cards twice', async () => {
  const userId = String(auth.user.id);
  warmWorksEntry(userId);
  const result = await takeWorksEntry(`http://localhost/api/assets?view=cards&type=all&source=creation&take=60&tab=generated&userId=${userId}`, userId, new AbortController().signal);
  expect(result.json.items).toHaveLength(60);
  expect(request.mock.calls.filter(([url]) => String(url).includes('/api/assets'))).toHaveLength(1);
});

it('retries a failed idle entry request in the foreground', async () => {
  const userId = String(auth.user.id);
  const original = request.getMockImplementation()!;
  request.mockRejectedValueOnce(new Error('idle connection closed'));
  warmWorksEntry(userId);
  request.mockImplementation(original);
  const result = await takeWorksEntry(`/api/assets?view=cards&type=all&source=creation&take=60&tab=generated&userId=${userId}`, userId, new AbortController().signal);
  expect(result.ok).toBe(true);
  expect(request.mock.calls.filter(([url]) => String(url).includes('/api/assets'))).toHaveLength(2);
});

it('does not fetch and decode a second offscreen image pool beside the virtualized gallery', async () => {
  await mount();
  const mediaRequests = request.mock.calls.filter(([raw]) => {
    const url = new URL(String(raw), 'http://localhost');
    return url.pathname.startsWith('/uploads/') || url.pathname === '/api/thumb';
  });
  expect(mediaRequests).toHaveLength(0);
});

it('returns to the first asset when switching sort direction back to a cached list', async () => {
  await mount();
  scroller().scrollTop = 7000;
  await act(async () => Simulate.scroll(scroller())); await flush();
  const sort = () => [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('时间'))!;
  await act(async () => Simulate.click(sort())); await flush();
  expect(scroller().scrollTop).toBe(0);
  expect(sort().textContent).toBe('时间正序');
  scroller().scrollTop = 4000;
  await act(async () => Simulate.scroll(scroller())); await flush();
  await act(async () => Simulate.click(sort())); await flush();
  expect(sort().textContent).toBe('时间倒序');
  expect(scroller().scrollTop).toBe(0);
  expect(host.querySelector('img')?.getAttribute('src')).toBe('/uploads/thumb-0.webp');
});

it('keeps cached category counts visible during refresh and on return', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => String(raw).includes('count=1') ? Promise.resolve(Response.json({ total: 60 })) : original(raw));
  await mount();
  const labels = () => host.querySelector('[aria-label="媒体分类"]')?.textContent;
  expect(labels()).toContain('图片60');
  request.mockImplementation(raw => String(raw).includes('count=1') ? new Promise(() => {}) : original(raw));
  await act(async () => Simulate.click(host.querySelector('button[aria-label="刷新资产"]')!)); await flush();
  expect(labels()).toContain('图片60');
  expect(labels()).not.toContain('—');
  await act(async () => root.render(null)); await mount();
  expect(labels()).toContain('图片60');
  expect(labels()).not.toContain('—');
});

it('selects by date across grid rows and preserves other dates when deselecting', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(raw => String(raw).includes('/api/assets') && !String(raw).includes('count=1') ? Promise.resolve(Response.json({ items: [...cards.slice(0, 12), { ...cards[12], createdAt: '2026-09-27T01:00:00Z' }], hasMore: false })) : original(raw));
  await mount();
  await act(async () => Simulate.click([...host.querySelectorAll('button')].find(b => b.textContent === '批量操作')!));
  expect(host.textContent).not.toContain('选择已加载素材');
  const first = host.querySelector('input[aria-label="选择 2026-09-28 全部素材"]') as HTMLInputElement;
  const second = host.querySelector('input[aria-label="选择 2026-09-27 全部素材"]') as HTMLInputElement;
  await act(async () => Simulate.change(first, { target: { checked: true } } as any));
  expect(host.textContent).toContain('已选 12');
  await act(async () => Simulate.change(second, { target: { checked: true } } as any));
  expect(host.textContent).toContain('已选 13');
  await act(async () => Simulate.change(first, { target: { checked: false } } as any));
  expect(host.textContent).toContain('已选 1');
  expect(second.checked).toBe(true);
});

it('reuses visible image nodes across thumbnail column changes without refetching', async () => {
  await mount();
  const images = [...host.querySelectorAll('img')].slice(0, 12);
  expect(images.length).toBe(12);
  const requestsBefore = request.mock.calls.length;
  const slider = host.querySelector('input[aria-label="资产缩略图大小"]') as HTMLInputElement;
  for (const size of [192, 112, 160, 96]) {
    await act(async () => Simulate.change(slider, { target: { value: String(size) } } as any));
    for (const image of images) {
      expect(host.contains(image)).toBe(true);
      expect(host.querySelector(`img[src="${image.getAttribute('src')}"]`)).toBe(image);
    }
  }
  expect(request.mock.calls.length).toBe(requestsBefore);
});
