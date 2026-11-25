/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { VirtuosoMockContext } from 'react-virtuoso';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import UserWorksPanel, { type WorksItem } from '@/components/admin/UserWorksPanel';
import { appendAdminWorksPage } from '@/components/admin/admin-user-works-state';

const previews = vi.hoisted(() => ({ jobs: [] as Array<{ candidates: string[]; cancel: ReturnType<typeof vi.fn> }> }));
vi.mock('@/lib/client/material-preview-queue', () => ({
  subscribeMaterialPreview: (candidates: string[]) => {
    const cancel = Object.assign(vi.fn(), { setPriority: vi.fn() });
    previews.jobs.push({ candidates, cancel });
    return cancel;
  },
}));
vi.mock('@/components/ui/resilient-image', () => ({
  ResilientImage: ({ candidates, loading }: any) => React.createElement('img', { src: candidates[0], loading, alt: '' }),
  warmResilientImageCandidatesBatch: vi.fn(() => () => {}),
}));
vi.mock('@/components/ui/hover-preview-video', () => ({
  HoverPreviewVideo: ({ posterSrc }: any) => React.createElement('img', { src: posterSrc, loading: 'lazy', 'data-legacy-video': true, alt: '' }),
  VideoBadge: () => null,
}));

let host: HTMLDivElement, root: Root;
let contentHeight = 6000;
const cards = (start: number, count = 40): WorksItem[] => Array.from({ length: count }, (_, offset) => ({
  id: start + offset, type: 'image_edit', status: 'success', createdAt: '2026-09-29T08:00:00Z',
  localPath: `/uploads/card-${start + offset}.webp`,
}));
const defaults = {
  dateFrom: '', dateTo: '', setDateFrom: vi.fn(), setDateTo: vi.fn(), typeFilter: 'all' as const,
  onOpenUnreferencedImports: vi.fn(), setTypeFilter: vi.fn(), sourceFilter: 'creation' as const, setSourceFilter: vi.fn(), isSearching: false,
  currentFilterTotal: 0, hasMore: true, currentPage: 1, inspirationMessage: null, inspirationBusyById: {},
  activeUser: { adminKey: 'auth:1', userId: 'device-1' }, onPushToInspiration: vi.fn(), onDetail: vi.fn(),
  onRequestDeleteGeneration: vi.fn(), onRequestBulkDeleteImports: vi.fn(), onRequestBulkDeleteGenerations: vi.fn(),
};
const flush = async () => act(async () => { await vi.advanceTimersByTimeAsync(80); });
const area = () => host.querySelector('[data-admin-works-scroll]') as HTMLElement;
const render = async (element: React.ReactNode) => {
  await act(async () => root.render(React.createElement(VirtuosoMockContext.Provider, { value: { viewportHeight: 600, itemHeight: 180 } }, element)));
  await flush();
};
beforeEach(() => {
  previews.jobs = [];
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); contentHeight = 6000;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON() {} });
  HTMLElement.prototype.scrollTo = function (value: any) { this.scrollTop = value.top || 0; };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

it('prepares more than one row beyond mounted cards and preserves overlapping downloads on append', async () => {
  const items = cards(1, 300);
  const props = { ...defaults, items, filteredItems: items, onLoadPage: vi.fn(async () => true) };
  await render(React.createElement(UserWorksPanel, props));
  const mounted = new Set([...host.querySelectorAll('img')].map(img => img.getAttribute('src')));
  const active = previews.jobs.filter(job => !job.cancel.mock.calls.length);
  const ahead = active.filter(job => !mounted.has(job.candidates[0]));
  expect(ahead.length).toBeGreaterThan(12);
  expect(ahead.length).toBeLessThanOrEqual(64);
  const nextItems = [...items, ...cards(301)];
  await render(React.createElement(UserWorksPanel, { ...props, items: nextItems, filteredItems: nextItems }));
  for (const job of ahead) expect(job.cancel).not.toHaveBeenCalled();
  const activeKeys = previews.jobs.filter(job => !job.cancel.mock.calls.length).map(job => job.candidates.join('|'));
  expect(new Set(activeKeys).size).toBe(activeKeys.length);
});

it('requests the next data batch while two screens are still available', async () => {
  const items = cards(1, 200);
  const load = vi.fn(() => new Promise<boolean>(() => {}));
  await render(React.createElement(UserWorksPanel, { ...defaults, items, filteredItems: items, onLoadPage: load }));
  expect(load).not.toHaveBeenCalled();
  area().scrollTop = 3400;
  await act(async () => Simulate.scroll(area())); await flush();
  expect(load).toHaveBeenCalledOnce();
});

it('loads mounted image and video covers eagerly using the same warmed image path', async () => {
  const items = cards(1).map((item, i) => i % 2 ? { ...item, type: 'video_gen', localPath: `/uploads/video-${i}.mp4`, thumbUrl: `/uploads/cover-${i}.webp` } : item);
  await render(React.createElement(UserWorksPanel, { ...defaults, items, filteredItems: items, hasMore: false, onLoadPage: vi.fn(async () => true) }));
  expect(host.querySelector('[data-legacy-video]')).toBeNull();
  expect([...host.querySelectorAll('img')].every(img => img.getAttribute('loading') === 'eager')).toBe(true);
  expect(host.querySelectorAll('video')).toHaveLength(0);
});

it('uses a 300px thumbnail for compact cards and server posters for legacy videos', async () => {
  const items = [cards(1)[0], { ...cards(2)[0], type: 'video_gen', localPath: '/uploads/legacy.mp4' }];
  await render(React.createElement(UserWorksPanel, { ...defaults, items, filteredItems: items, hasMore: false, onLoadPage: vi.fn(async () => true) }));
  const sources = [...host.querySelectorAll('img')].map(img => img.getAttribute('src'));
  expect(sources).toContain('/api/thumb?src=%2Fuploads%2Fcard-1.webp&w=300');
  expect(sources).toContain('/api/thumb?src=%2Fuploads%2Flegacy.mp4&w=300&poster=1');
  expect(host.querySelectorAll('video')).toHaveLength(0);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('loads more before the end without a next-page button and keeps existing cards and scroll position', async () => {
  let release!: () => void;
  const requested = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  function Harness() {
    const [items, setItems] = React.useState(cards(1));
    const [page, setPage] = React.useState(1);
    return React.createElement(UserWorksPanel, { ...defaults, items, filteredItems: items, currentPage: page, hasMore: page === 1, onLoadPage: async () => {
      await requested(); setItems(previous => appendAdminWorksPage(previous, cards(41))); setPage(2); return true;
    } });
  }
  await render(React.createElement(Harness));
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '下一页')).toBe(false);
  expect(area()).not.toBeNull();
  expect(requested).not.toHaveBeenCalled();
  area().scrollTop = 4600;
  await act(async () => Simulate.scroll(area())); await flush();
  expect(requested).toHaveBeenCalledOnce();
  await act(async () => Simulate.scroll(area())); await flush();
  expect(requested).toHaveBeenCalledOnce();
  const before = area().scrollTop;
  await act(async () => release()); await flush();
  expect(host.textContent).toContain('已显示全部 80 条');
  expect(area().scrollTop).toBe(before);
  expect(host.textContent).not.toContain('此分类下暂无记录');
});

it('renders a small media window even after 10000 lightweight cards have been browsed', async () => {
  const items = cards(1, 10000);
  const load = vi.fn(async () => true);
  await render(React.createElement(UserWorksPanel, { ...defaults, items, filteredItems: items, hasMore: false, onLoadPage: load }));
  expect(host.querySelectorAll('img').length).toBeGreaterThan(0);
  expect(host.querySelectorAll('img').length).toBeLessThan(100);
  expect(host.querySelectorAll('video')).toHaveLength(0);
  expect(load).not.toHaveBeenCalled();
});

it('keeps the current list visible when append requests fail and allows retry', async () => {
  const items = cards(1);
  const load = vi.fn(async () => false);
  await render(React.createElement(UserWorksPanel, { ...defaults, items, filteredItems: items, onLoadPage: load }));
  expect(area()).not.toBeNull();
  area().scrollTop = 5400;
  await act(async () => Simulate.scroll(area()));
  await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
  expect(host.textContent).toContain('重试加载');
  expect(host.textContent).not.toContain('此分类下暂无记录');
  expect(host.querySelectorAll('img').length).toBeGreaterThan(0);
});

it('keeps cleanup entry in selection mode across loading and hides cancel', async () => {
  const items = cards(1, 3);
  const onOpenUnreferencedImports = vi.fn();
  const requestPurge = vi.fn();
  const props = { ...defaults, items, filteredItems: items, hasMore: false, bulkDeleteResetSignal: 0, onOpenUnreferencedImports, onRequestBulkDeleteImports: requestPurge, onLoadPage: vi.fn(async () => true) };
  const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  await render(React.createElement(UserWorksPanel, props));
  await act(async () => button('批量选择')!.click());
  await act(async () => button('清理未引用素材')!.click());
  expect(onOpenUnreferencedImports).toHaveBeenCalledTimes(1);
  expect(requestPurge).not.toHaveBeenCalled();
  await render(null);
  await render(React.createElement(UserWorksPanel, { ...props, typeFilter: 'import', cleanupMode: true }));
  expect(button('批量选择')).toBeUndefined();
  expect(button('全部')).toBeDefined();
  expect(button('选中失败')).toBeDefined();
  expect(button('删除')!.disabled).toBe(true);
  expect(button('取消选择')).toBeUndefined();
  await render(React.createElement(UserWorksPanel, { ...props, typeFilter: 'import', cleanupMode: true, bulkDeleteResetSignal: 1 }));
  expect(button('全部')).toBeDefined();
  expect(button('取消选择')).toBeUndefined();
});

it('keeps normal category entry in browse mode with normal selection and cancel', async () => {
  const items = cards(1, 3);
  const props = { ...defaults, items, filteredItems: items, hasMore: false, typeFilter: 'import' as const, bulkDeleteResetSignal: 0, onLoadPage: vi.fn(async () => true) };
  const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  await render(React.createElement(UserWorksPanel, props));
  expect(button('批量选择')).toBeDefined();
  expect(button('取消选择')).toBeUndefined();
  await act(async () => button('批量选择')!.click());
  expect(button('全部')).toBeDefined();
  expect(button('取消选择')).toBeDefined();
  await act(async () => button('取消选择')!.click());
  expect(button('批量选择')).toBeDefined();
});

it('selects all filtered imports without deleting, including unloaded cards, and deletes only the remaining selection', async () => {
  const items = cards(1, 3);
  const requestPurge = vi.fn();
  const requestDelete = vi.fn();
  const fetchIds = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ scopeKey: 'auth:1', ids: [1, 2, 3, 4] })));
  vi.stubGlobal('fetch', fetchIds);
  const props = { ...defaults, items, filteredItems: items, hasMore: false, typeFilter: 'import' as const, cleanupMode: true, currentFilterTotal: 4, onRequestBulkDeleteImports: requestPurge, onRequestBulkDeleteGenerations: requestDelete, onLoadPage: vi.fn(async () => true) };
  const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!;
  await render(React.createElement(UserWorksPanel, props));
  await act(async () => button('全部').click());
  expect(fetchIds).toHaveBeenCalledTimes(1);
  expect(fetchIds.mock.calls[0][0]).toContain('typeFilter=import&idsOnly=1');
  expect(requestPurge).not.toHaveBeenCalled();
  expect(requestDelete).not.toHaveBeenCalled();
  expect(button('删除 (4)').disabled).toBe(false);
  for (const card of host.querySelectorAll('[data-admin-work-id]')) expect(card.className).toContain('ring-2');
  await act(async () => (host.querySelector('[data-admin-work-id="2"]') as HTMLElement).click());
  await act(async () => button('删除 (3)').click());
  expect(requestDelete).toHaveBeenCalledWith([1, 3, 4]);
  await render(React.createElement(UserWorksPanel, { ...props, items: cards(1, 4), filteredItems: cards(1, 4) }));
  expect(host.querySelector('[data-admin-work-id="4"]')?.className).toContain('ring-2');
  expect(button('取消')).toBeDefined();
  await act(async () => button('取消').click());
  expect(button('全部')).toBeDefined();
  expect(button('删除').disabled).toBe(true);
  expect(button('批量选择')).toBeUndefined();
  for (const card of host.querySelectorAll('[data-admin-work-id]')) expect(card.className).not.toContain('ring-2');
  expect(fetchIds).toHaveBeenCalledTimes(1);
  expect(requestPurge).not.toHaveBeenCalled();
  expect(requestDelete).toHaveBeenCalledTimes(1);

});
