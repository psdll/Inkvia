import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ accounts: 0, create: vi.fn() }));
vi.mock('@/lib/prisma', () => {
  const db = { whitelistName: { create: state.create }, $queryRaw: vi.fn(async () => [{ accounts: state.accounts }]) };
  return { prisma: db, default: db };
});
vi.mock('@/lib/admin-auth', () => ({ requireAdminRequest: () => ({ ok: true, username: 'admin' }) }));
vi.mock('@/lib/admin-audit', () => ({ logAdminAction: vi.fn(async () => {}) }));
import { GET, POST } from '@/app/api/admin/auth-users/route';

it('refreshes account totals after a write even when another admin reads during the write', async () => {
  let completeWrite!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  state.create.mockImplementation(() => new Promise<void>(resolve => {
    completeWrite = () => { state.accounts = 1; resolve(); };
    markStarted();
  }));
  const summary = async () => (await GET(new NextRequest('http://localhost/api/admin/auth-users?view=summary'))).json();
  expect((await summary()).accounts).toBe(0);
  const write = POST(new NextRequest('http://localhost/api/admin/auth-users', {
    method: 'POST', body: JSON.stringify({ action: 'add_whitelist', names: ['synthetic-user'] }),
    headers: { 'content-type': 'application/json' },
  }));
  await started;
  expect((await summary()).accounts).toBe(0);
  completeWrite();
  expect((await write).status).toBe(200);
  expect((await summary()).accounts).toBe(1);
});
