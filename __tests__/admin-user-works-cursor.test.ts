import { describe, expect, it } from "vitest";
import {
  buildCreatedAtCursorWhere,
  decodeAdminWorksCursor,
  encodeAdminWorksCursor,
  getAdminWorksSyncCursor,
  splitAdminWorksPage,
} from "@/lib/admin-user-works-cursor";

describe("admin works opaque cursor", () => {
  it("round trips immutable createdAt and generation id without exposing raw JSON", () => {
    const value = { createdAt: new Date("2026-07-16T00:00:00.000Z"), id: 42 };

    const encoded = encodeAdminWorksCursor(value);

    expect(encoded).not.toContain("createdAt");
    expect(decodeAdminWorksCursor(encoded)).toEqual(value);
  });

  it("rejects malformed, invalid date, and non-positive id cursors", () => {
    expect(() => decodeAdminWorksCursor("not-base64")) .toThrow("invalid cursor");
    expect(() => decodeAdminWorksCursor(Buffer.from(JSON.stringify({ createdAt: "bad", id: 1 })).toString("base64url")))
      .toThrow("invalid cursor");
    expect(() => decodeAdminWorksCursor(Buffer.from(JSON.stringify({ createdAt: "2026-07-16T00:00:00.000Z", id: 0 })).toString("base64url")))
      .toThrow("invalid cursor");
  });

  it("builds a stable descending createdAt and id continuation filter", () => {
    const createdAt = new Date("2026-07-16T00:00:00.000Z");

    expect(buildCreatedAtCursorWhere({ createdAt, id: 42 })).toEqual({
      OR: [
        { createdAt: { lt: createdAt } },
        { AND: [{ createdAt }, { id: { lt: 42 } }] },
      ],
    });
  });

  it("uses one lookahead row to produce the next opaque cursor", () => {
    const rows = [
      { id: 3, createdAt: new Date("2026-07-16T00:00:03.000Z") },
      { id: 2, createdAt: new Date("2026-07-16T00:00:02.000Z") },
      { id: 1, createdAt: new Date("2026-07-16T00:00:01.000Z") },
    ];

    const page = splitAdminWorksPage(rows, 2);

    expect(page.items.map((row) => row.id)).toEqual([3, 2]);
    expect(page.hasMore).toBe(true);
    expect(decodeAdminWorksCursor(page.nextCursor || "")).toEqual({
      createdAt: rows[1].createdAt,
      id: 2,
    });
  });

  it("builds a sync cursor from the greatest updatedAt and id, including empty pages", () => {
    const fallback = new Date("2026-07-16T00:00:09.000Z");
    const rows = [
      { id: 1, updatedAt: new Date("2026-07-16T00:00:01.000Z") },
      { id: 3, updatedAt: new Date("2026-07-16T00:00:02.000Z") },
      { id: 2, updatedAt: new Date("2026-07-16T00:00:02.000Z") },
    ];

    expect(getAdminWorksSyncCursor(rows, fallback)).toEqual({
      updatedAt: "2026-07-16T00:00:02.000Z",
      id: 3,
    });
    expect(getAdminWorksSyncCursor([], fallback)).toEqual({
      updatedAt: fallback.toISOString(),
      id: 0,
    });
  });
});
