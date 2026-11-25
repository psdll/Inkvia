import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildHistoryStatusUrl, fetchHistoryStatuses } from "@/lib/history/client";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compact history status client", () => {
  it("builds an authenticated compact URL without accepting a user id", () => {
    expect(buildHistoryStatusUrl({ ids: [9, 7], type: "image_edit", source: "all", status: "in_progress" })).toBe(
      "/api/history?view=status&ids=9%2C7&type=image_edit&source=all&status=in_progress",
    );
  });

  it("returns compact items and rejects failed requests", async () => {
    const items = [
      {
        id: 9,
        type: "image_edit",
        status: "running",
        localPath: null,
        errorMsg: null,
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchHistoryStatuses({ ids: [9], source: "all" })).resolves.toEqual(items);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/history?view=status&ids=9&source=all",
      expect.objectContaining({ cache: "no-store" }),
    );

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => null });
    await expect(fetchHistoryStatuses({ ids: [9] })).rejects.toThrow("history status 503");
  });

  it("shares an in-flight all-source request with a watched-id subset", async () => {
    let releaseResponse: ((value: unknown) => void) | undefined;
    const response = new Promise((resolve) => {
      releaseResponse = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const allItems = fetchHistoryStatuses({ ids: [101, 102], source: "all" });
    const watchedItems = fetchHistoryStatuses({ ids: [102], source: "all" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseResponse?.({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: 101, status: "running" },
          { id: 102, status: "success", localPath: "/result.png" },
        ],
      }),
    });

    await expect(allItems).resolves.toHaveLength(2);
    await expect(watchedItems).resolves.toEqual([
      expect.objectContaining({ id: 102, status: "success" }),
    ]);
  });
});

describe("history poller source contracts", () => {
  it("suspends the running hook while its kept-alive tool is inactive", () => {
    const hook = read("lib/hooks/use-generation-running.ts");


    expect(hook).toContain("enabled = true");
    expect(hook).toContain("if (!enabled || !userId || !type) return false");
    expect(hook).toContain("fetchHistoryStatuses");
    expect(hook).toContain("window.setTimeout");
    expect(hook).toContain("jitterPollDelay");
    expect(hook).not.toContain("window.setInterval");

  });

  it("stages non-primary refreshes after a page becomes visible", () => {
    const actions = read("components/history/unified-history-actions.tsx");

    expect(actions).toContain("HISTORY_SUMMARY_VISIBILITY_RESUME_DELAY_MS");
    expect(actions).toContain("window.setTimeout(() => void run(), HISTORY_SUMMARY_VISIBILITY_RESUME_DELAY_MS)");
  });

  it("moves the always-on task summary to a slower jittered timeout", () => {
    const actions = read("components/history/unified-history-actions.tsx");

    expect(actions).toContain("const HISTORY_SUMMARY_POLL_MS = 15_000");
    expect(actions).toContain("jitterPollDelay(HISTORY_SUMMARY_POLL_MS)");
    expect(actions).toContain("window.setTimeout");
    expect(actions).toContain("if (!open) return");
    expect(actions).toContain('url.searchParams.set("take", "200")');
  });

  it("pages full history and reconciles running rows through compact status snapshots", () => {
    const panel = read("components/history/unified-history-panel.tsx");

    expect(panel).toContain('url.searchParams.set("take", "50")');
    expect(panel).toContain('url.searchParams.set("cursor", cursor)');
    expect(panel).not.toContain('url.searchParams.set("skip"');
    expect(panel).toContain("loadNextPage");
    expect(panel).toContain("fetchHistoryStatuses({ ids, source: \"all\" })");
    expect(panel).toContain("sameHistoryStatusSnapshot");
    expect(panel).toContain("loadHistoryItem(String(status.id))");
    expect(panel).toContain("status.displayUrl");
    expect(panel).toContain("const activeDisplayUrl = getHistoryDisplayUrl(activeItem)");
    expect(panel).toContain("const groupDisplayUrl = getHistoryDisplayUrl(it)");
    expect(panel).toContain('fetchHistoryStatuses({ source: "tool", status: "in_progress" })');
    expect(panel).toContain("applyHistoryItem(toHistoryStatusItem(status))");
    expect(panel).toContain("inProgressCount");
    expect(panel).toContain("jitterPollDelay");
    expect(panel).not.toContain("window.setInterval(() => void tick(), 2000)");
  });

  it("polls only the short saving phase faster without changing the normal active cadence", () => {
    const panel = read("components/history/unified-history-panel.tsx");

    expect(panel).toContain("const HISTORY_ACTIVE_POLL_MS = 2_000;");
    expect(panel).toContain("const HISTORY_SAVING_POLL_MS = 700;");
    expect(panel).toContain('(delay, item) => item.phase === "saving" ? HISTORY_SAVING_POLL_MS : delay');
    expect(panel).toContain('statuses.some((status) => status.phase === "saving")');
  });
});
