import { describe, expect, it } from "vitest";
import {
  buildHistoryCursorWhere,
  decodeHistoryCursor,
  encodeHistoryCursor,
  splitHistoryPage,
} from "@/lib/history/cursor";
import {
  jitterPollDelay,
  parseHistoryStatusIds,
  sameHistoryStatusSnapshot,
  type HistoryStatusRecord,
} from "@/lib/history/status";
import { mergePreferredById, replaceById } from "@/lib/history/page-state";

describe("history cursor primitives", () => {
  it("round-trips a stable createdAt plus id cursor", () => {
    const cursor = { createdAt: new Date("2026-07-21T00:00:00.000Z"), id: 42 };

    expect(decodeHistoryCursor(encodeHistoryCursor(cursor))).toEqual(cursor);
    expect(buildHistoryCursorWhere(cursor)).toEqual({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { lt: 42 } }] },
      ],
    });
  });

  it("rejects malformed cursor values", () => {
    expect(() => decodeHistoryCursor("broken")).toThrow("invalid cursor");
    expect(() =>
      decodeHistoryCursor(
        Buffer.from(JSON.stringify({ createdAt: "2026-07-21T00:00:00.000Z", id: 0 })).toString("base64url"),
      ),
    ).toThrow("invalid cursor");
  });

  it("splits a page and encodes the last returned row", () => {
    const rows = [
      { id: 3, createdAt: new Date("2026-07-21T03:00:00.000Z") },
      { id: 2, createdAt: new Date("2026-07-21T02:00:00.000Z") },
      { id: 1, createdAt: new Date("2026-07-21T01:00:00.000Z") },
    ];

    const page = splitHistoryPage(rows, 2);

    expect(page.items.map((item) => item.id)).toEqual([3, 2]);
    expect(page.hasMore).toBe(true);
    expect(decodeHistoryCursor(page.nextCursor!)).toEqual({ createdAt: rows[1].createdAt, id: 2 });
  });
});

describe("history compact status primitives", () => {
  const running: HistoryStatusRecord = {
    id: 7,
    type: "image_edit",
    status: "running",
    localPath: null,
    errorMsg: null,
    updatedAt: "2026-07-21T00:00:00.000Z",
  };

  it("deduplicates, validates, and bounds requested ids", () => {
    expect(parseHistoryStatusIds("4,4,-1,nope,8", 3)).toEqual([4, 8]);
    expect(parseHistoryStatusIds("1,2,3,4", 2)).toEqual([1, 2]);
  });

  it("compares snapshots by visible fields and stable id rather than response order", () => {
    const second = { ...running, id: 8, status: "queued" };

    expect(sameHistoryStatusSnapshot([running, second], [{ ...second }, { ...running }])).toBe(true);
    expect(sameHistoryStatusSnapshot([running], [{ ...running, status: "success" }])).toBe(false);
    expect(sameHistoryStatusSnapshot([running], [{ ...running, localPath: "/uploads/result.png" }])).toBe(false);
    expect(sameHistoryStatusSnapshot(
      [running],
      [{ ...running, displayUrl: "https://provider.test/preview.png" } as HistoryStatusRecord],
    )).toBe(false);
  });

  it("adds bounded ten-percent poll jitter", () => {
    expect(jitterPollDelay(2000, () => 0)).toBe(1800);
    expect(jitterPollDelay(2000, () => 0.5)).toBe(2000);
    expect(jitterPollDelay(2000, () => 1)).toBe(2200);
  });
});

describe("history page state primitives", () => {
  it("keeps preferred rows first and deduplicates fallback rows", () => {
    const previous = [
      { id: "1", status: "running" },
      { id: "2", status: "success" },
    ];

    expect(mergePreferredById([{ id: "1", status: "success" }], previous)).toEqual([
      { id: "1", status: "success" },
      { id: "2", status: "success" },
    ]);
  });

  it("replaces one id while retaining untouched object identity", () => {
    const previous = [
      { id: "1", status: "running" },
      { id: "2", status: "success" },
    ];

    const next = replaceById(previous, { id: "1", status: "success" });

    expect(next[0]).toEqual({ id: "1", status: "success" });
    expect(next[1]).toBe(previous[1]);
    expect(replaceById(next, { id: "1", status: "success" })).toBe(next);
  });
});
