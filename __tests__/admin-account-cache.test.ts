import { afterEach, expect, it, vi } from 'vitest';
import { clearAuthUsersCache, getAuthUsersCache, setAuthUsersCache, warmAuthUsers } from '@/lib/admin/auth-users-cache';
afterEach(() => { clearAuthUsersCache(); vi.unstubAllGlobals(); });
it('bounds cached account pages and excludes credentials', () => {
  for (let i=0;i<10;i++) setAuthUsersCache({whitelist:[],users:[{id:i,username:'u',createdAt:'',generationCount:1,password:'secret'} as any]},String(i));
  expect(getAuthUsersCache('0')).toBeNull();
  expect(getAuthUsersCache('9')?.users[0]).not.toHaveProperty('password');
});
it('cannot resurrect stale accounts when a mutation invalidates a pending preload', async () => {
  let resolve!: (value:unknown) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(done => {resolve=done})));
  const pending=warmAuthUsers();
  clearAuthUsersCache();
  resolve({ok:true,json:async()=>({whitelist:[{id:1,name:'removed',createdAt:''}],users:[]})});
  await pending;
  expect(getAuthUsersCache()).toBeNull();
});
