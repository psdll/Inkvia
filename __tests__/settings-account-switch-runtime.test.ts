// @vitest-environment jsdom
import * as React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/components/auth/AuthProvider';
import LoginModal from '@/components/auth/LoginModal';
import SettingsPage from '@/app/settings/page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, prefetch, ...props }: any) => React.createElement("a", props, children) }));
vi.mock('@/components/settings/general-settings-panel', () => ({ GeneralSettingsPanel: () => React.createElement("div", null, "偏好设置") }));
vi.mock('@/lib/ephemeral-input-draft', () => ({ ephemeralInputDraftRegistry: { clearOwner: vi.fn() } }));

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let auth: ReturnType<typeof useAuth>;
let request: ReturnType<typeof vi.fn>;
const oldUser = { id: 7, username: '原账号', isAdmin: true };
const newUser = { id: 8, username: '新账号' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function Probe() { auth = useAuth(); return null; }
function button(text: string) { return [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === text)!; }
async function openSwitch() { await act(async () => button('切换账号').click()); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/settings');
  localStorage.clear();
  request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? json({ error: '密码错误' }, 401) : json({ user: oldUser }));
  vi.stubGlobal('fetch', request);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(React.createElement(AuthProvider, null, React.createElement(QueryClientProvider, { client }, React.createElement(Probe), React.createElement(SettingsPage), React.createElement(LoginModal)))));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('opens and cancels switching without logging out or changing the account', async () => {
  await openSwitch();
  expect(request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  expect(auth.user).toEqual(oldUser);
  expect(auth.showLoginModal).toBe(true);
  expect(host.textContent).toContain('成功登录新账号后才会切换');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭登录窗口"]')!.click());
  expect(auth.user).toEqual(oldUser);
  expect(auth.showLoginModal).toBe(false);
});

it('keeps the current account and local drafts after incorrect credentials', async () => {
  localStorage.setItem('draft_image_v1_test', 'original draft');
  const onLogout = vi.fn(); window.addEventListener('auth:logout', onLogout);
  await openSwitch();
  let result: { success: boolean } | undefined;
  await act(async () => { result = await auth.login('新账号', 'synthetic wrong password'); });
  expect(result?.success).toBe(false);
  expect(auth.user).toEqual(oldUser);
  expect(localStorage.getItem('draft_image_v1_test')).toBe('original draft');
  expect(onLogout).not.toHaveBeenCalled();
  window.removeEventListener('auth:logout', onLogout);
});

it('keeps the current account after a network failure', async () => {
  await openSwitch();
  request.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { expect((await auth.login('新账号', 'synthetic password')).success).toBe(false); });
  expect(auth.user).toEqual(oldUser);
  await act(async () => auth.closeLoginModal());
  expect(auth.user).toEqual(oldUser);
});

it('only changes account and clears old account drafts after successful authentication', async () => {
  localStorage.setItem('draft_image_v1_test', 'original draft');
  await openSwitch();
  let resolve!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  let attempt!: ReturnType<typeof auth.login>;
  await act(async () => { attempt = auth.login('新账号', 'synthetic password'); });
  expect(auth.user).toEqual(oldUser);
  expect(localStorage.getItem('draft_image_v1_test')).toBe('original draft');
  await act(async () => { resolve(json({ success: true, user: newUser })); await attempt; });
  expect(auth.user).toEqual(newUser);
  expect(auth.showLoginModal).toBe(false);
  expect(localStorage.getItem('draft_image_v1_test')).toBeNull();
  expect(request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});

it('does not display an administrator badge next to the account name', () => {
  const account = host.querySelector('[aria-label="当前账号"]');
  expect(account?.textContent).toContain('原账号');
  expect(account?.textContent).not.toContain('管理员');
});

it('does not dismiss an in-flight switch and permits cancel after a failed response', async () => {
  await openSwitch();
  await act(async () => {
    Simulate.change(host.querySelector<HTMLInputElement>('input[type="text"]')!, { target: { value: '新账号' } } as any);
    Simulate.change(host.querySelector<HTMLInputElement>('input[type="password"]')!, { target: { value: 'synthetic password' } } as any);
  });
  let resolve!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  await act(async () => Simulate.submit(host.querySelector('form')!));
  const close = host.querySelector<HTMLButtonElement>('[aria-label="关闭登录窗口"]')!;
  expect(close.disabled).toBe(true);
  await act(async () => close.click());
  expect(auth.showLoginModal).toBe(true);
  expect(auth.user).toEqual(oldUser);
  await act(async () => { resolve(json({ error: '密码错误' }, 401)); });
  expect(host.textContent).toContain('密码错误');
  expect(close.disabled).toBe(false);
  await act(async () => close.click());
  expect(auth.showLoginModal).toBe(false);
  expect(auth.user).toEqual(oldUser);
});


it('shows switching and logout directly in the account section', () => {
  const account = host.querySelector('[aria-label="当前账号"]')!;
  expect(account.textContent).toContain('切换账号');
  expect(account.textContent).toContain('退出登录');
  expect(button('账号操作')).toBeUndefined();
  expect(auth.user).toEqual(oldUser);
});

it('logs out only after choosing logout and displays the login entry', async () => {
  expect(request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  await act(async () => button('退出登录').click());
  expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  expect(auth.user).toBeNull();
  expect(button('登录账号')).toBeDefined();
  expect(button('切换账号')).toBeUndefined();
});
