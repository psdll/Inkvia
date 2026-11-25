import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDesktopInputDrafts,
  desktopDraftMediaItems,
  desktopDraftUploadWasPending,
  readDesktopInputDraft,
  recoverDesktopDraftMedia,
  writeDesktopInputDraft,
} from "@/lib/desktop-input-draft";

const mediaId = "5c41e870-fff0-4c35-9737-6f58c11670a8";
const draftSessionId = "490e39c1-8ae9-4b80-afa5-6adfd281bf11";

afterEach(() => vi.unstubAllGlobals());

describe("desktop input drafts", () => {
  it("uses session storage only in desktop mode and clears only the specified account", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      get length() { return values.size; },
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      key: (index: number) => [...values.keys()][index],
    });
    writeDesktopInputDraft(false, "toolbox:image", "a", { prompt: "web" });
    expect(values.size).toBe(0);
    writeDesktopInputDraft(true, "toolbox:image", "a", { prompt: "image" });
    writeDesktopInputDraft(true, "toolbox:video", "a", { prompt: "video" });
    writeDesktopInputDraft(true, "toolbox:image", "b", { prompt: "other" });
    expect(readDesktopInputDraft(false, "toolbox:image", "a")).toBeNull();
    expect(readDesktopInputDraft(true, "toolbox:image", "a")).toEqual({ prompt: "image" });
    clearDesktopInputDrafts("a");
    expect(readDesktopInputDraft(true, "toolbox:video", "a")).toBeNull();
    expect(readDesktopInputDraft(true, "toolbox:image", "b")).toEqual({ prompt: "other" });
  });

  it("restores media by ID without changing order or slots, even for the same file in both slots", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      items: [{ mediaId, status: "ready", kind: "image", localPreviewUrl: "/uploads/restored.png" }],
    }));
    const items = [{ mediaId, slot: "first" }, { url: "/uploads/other.png" }, { mediaId, slot: "last" }];
    const restored = await recoverDesktopDraftMedia(draftSessionId, items, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toContain(`mediaIds=${mediaId}`);
    expect(restored.map(({ url, slot }) => [url, slot])).toEqual([
      ["/uploads/restored.png", "first"],
      ["/uploads/other.png", undefined],
      ["/uploads/restored.png", "last"],
    ]);
  });

  it("detects interrupted uploads without keeping temporary previews or embedded files", () => {
    expect(desktopDraftUploadWasPending([{ uploadState: "verifying" }])).toBe(true);
    expect(desktopDraftUploadWasPending([{ uploadState: "ready", mediaId }])).toBe(false);
    expect(desktopDraftMediaItems([{ url: "blob:temporary" }, { url: "data:image/png;base64,abc" }, { mediaId, url: "/uploads/ready.png" }])).toEqual([
      { mediaId, url: "/uploads/ready.png" },
    ]);
  });
});
