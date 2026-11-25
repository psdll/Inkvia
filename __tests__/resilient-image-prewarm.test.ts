// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  warmResilientImageCandidates,
  warmResilientImageCandidatesBatch,
} from "@/components/ui/resilient-image";

function installImageDecodeEnvironment() {
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:test-${Math.random()}`),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal("Image", class {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    decoding = "async";

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resilient image prewarm coordination", () => {
  it("deduplicates concurrent fetch and decode work for the same candidate group", async () => {
    installImageDecodeEnvironment();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["image"], { type: "image/webp" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const candidates = [`/api/thumb?dedupe=${Date.now()}`];
    const [first, second] = await Promise.all([
      warmResilientImageCandidates(candidates),
      warmResilientImageCandidates(candidates),
    ]);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the active batch when the owning user panel is replaced", () => {
    const image = document.createElement("img");
    vi.spyOn(document, "createElement").mockReturnValue(image);
    vi.stubGlobal("window", {
      requestIdleCallback: (callback: IdleRequestCallback) => {
        callback({ didTimeout: false, timeRemaining: () => 50 });
        return 1;
      },
      cancelIdleCallback: vi.fn(),
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("fetch", vi.fn());

    const cancel = warmResilientImageCandidatesBatch(
      [[`/api/thumb?abort=${Date.now()}`]],
      { limit: 1, batchSize: 1 },
    );
    expect(image.getAttribute("src")).toContain("/api/thumb?abort=");
    cancel();
    expect(image.hasAttribute("src")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('bounds retained decoded pixels while browsing many different large thumbnails', async () => {
  installImageDecodeEnvironment();
  vi.stubGlobal('Image', class {
    naturalWidth = 1200; naturalHeight = 1200;
    onload: null | (() => void) = null; onerror = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image'], { type: 'image/webp' }) })));
  for (let i = 0; i < 1200; i++) await warmResilientImageCandidates([`/pixel-budget-${i}.webp`]);
  const retained = vi.mocked(URL.createObjectURL).mock.calls.length - vi.mocked(URL.revokeObjectURL).mock.calls.length;
  expect(retained * 1200 * 1200 * 4).toBeLessThanOrEqual(96 * 1024 * 1024);
});

it('does not retain a large original image blob as a thumbnail', async () => {
  installImageDecodeEnvironment();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'image/png' }) })));
  expect(await warmResilientImageCandidates(['/oversized-original.png'])).toBeNull();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});


it('also bounds compressed blob bytes for small images with large files', async () => {
  vi.resetModules();
  const { warmResilientImageCandidates: warm } = await import('@/components/ui/resilient-image');
  installImageDecodeEnvironment();
  vi.stubGlobal('Image', class {
    naturalWidth = 10; naturalHeight = 10;
    onload: null | (() => void) = null; onerror = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(1024 * 1024)], { type: 'image/webp' }) })));
  for (let i = 0; i < 30; i++) await warm([`/byte-budget-${i}.webp`]);
  const retained = vi.mocked(URL.createObjectURL).mock.calls.length - vi.mocked(URL.revokeObjectURL).mock.calls.length;
  expect(retained).toBeLessThanOrEqual(16);
});
