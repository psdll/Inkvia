import { describe, expect, it } from "vitest";
import {
  appendHistoryPage,
  mergeHistoryFirstPage,
  parseHistoryPageCache,
  replaceById,
} from "@/lib/history/page-state";

type Row = { id: string; status: string };

describe("history pagination state", () => {
  it("accepts legacy cache entries without cursor metadata", () => {
    const parsed = parseHistoryPageCache<Row>({
      items: [{ id: "2", status: "success" }],
      fetchedAt: 123,
    });

    expect(parsed).toEqual({
      items: [{ id: "2", status: "success" }],
      fetchedAt: 123,
      nextCursor: null,
      hasMore: undefined,
    });
  });

  it("puts a fresh first page before cached older rows without discarding them", () => {
    const cached = Array.from({ length: 60 }, (_, index) => ({ id: String(100 - index), status: "success" }));
    const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: String(110 - index), status: "success" }));
    const merged = mergeHistoryFirstPage(firstPage, cached);

    expect(merged.slice(0, 3).map((row) => row.id)).toEqual(["110", "109", "108"]);
    expect(merged).toHaveLength(70);
    expect(merged.at(-1)?.id).toBe("41");
  });

  it("appends a cursor page once even when the boundary id repeats", () => {
    const current = [
      { id: "5", status: "success" },
      { id: "4", status: "success" },
    ];
    const appended = appendHistoryPage(current, [
      { id: "4", status: "success" },
      { id: "3", status: "success" },
    ]);

    expect(appended.map((row) => row.id)).toEqual(["5", "4", "3"]);
  });

  it("replaces only the changed record", () => {
    const first = { id: "5", status: "running" };
    const untouched = { id: "4", status: "success" };
    const result = replaceById([first, untouched], { id: "5", status: "success" });

    expect(result[0]).not.toBe(first);
    expect(result[1]).toBe(untouched);
  });
});
