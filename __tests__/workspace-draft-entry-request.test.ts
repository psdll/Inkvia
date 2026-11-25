import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetchDraft: vi.fn() }));
vi.mock("@/lib/tool-workspace-draft/client", () => ({ fetchToolWorkspaceDraft: mocks.fetchDraft }));
beforeEach(() => { vi.resetModules(); mocks.fetchDraft.mockReset(); });

it("shares only the pending request for the same account and reads afresh after it settles", async () => {
  let finish!: (value: null) => void;
  mocks.fetchDraft.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue(null);
  const { fetchImageDraftForEntry } = await import("@/lib/tool-workspace-draft/entry-request");
  const prefetched = fetchImageDraftForEntry("account-a");
  expect(fetchImageDraftForEntry("account-a")).toBe(prefetched);
  await fetchImageDraftForEntry("account-b");
  expect(mocks.fetchDraft).toHaveBeenCalledTimes(2);
  finish(null);
  await prefetched;
  await fetchImageDraftForEntry("account-a");
  expect(mocks.fetchDraft).toHaveBeenCalledTimes(3);
});

it("retries a failed prefetch on actual entry", async () => {
  mocks.fetchDraft.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
  const { fetchImageDraftForEntry } = await import("@/lib/tool-workspace-draft/entry-request");
  await expect(fetchImageDraftForEntry("account-a")).rejects.toThrow("offline");
  expect(await fetchImageDraftForEntry("account-a")).toBeNull();
});
