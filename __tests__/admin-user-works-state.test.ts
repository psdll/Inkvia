import { describe, expect, it } from "vitest";
import {
  AdminUserWorksCache,
  AdminWorksRequestGate,
  appendAdminWorksPage,
  buildAdminWorksChangesQuery,
  canStartAdminWorksPolling,
  loadAllFailedWorkIds,
  mergeAdminWorks,
  parseAdminWorksCursor,
  type AdminWorksCursor,
} from "@/components/admin/admin-user-works-state";

type Work = {
  id: number;
  createdAt: string;
  finishedAt?: string | null;
  updatedAt?: string;
};

const cursor = (id: number): AdminWorksCursor => ({
  updatedAt: `2026-07-16T00:00:${String(id).padStart(2, "0")}.000Z`,
  id,
});

describe("admin user works state", () => {
  it("loads every failed generation for the user instead of limiting selection to loaded dates", async () => {
    let requestedUrl = "";
    const fetcher = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        scopeKey: "auth:123",
        failedIds: [31, 7],
      }));
    };

    await expect(loadAllFailedWorkIds("auth:123", fetcher)).resolves.toEqual([31, 7]);

    const query = new URL(requestedUrl, "http://localhost").searchParams;
    expect(query.get("adminKey")).toBe("auth:123");
    expect(query.get("failedIdsOnly")).toBe("1");
    expect(query.has("all")).toBe(false);
  });

  it("rejects user A response after switching to user B", () => {
    const gate = new AdminWorksRequestGate();
    const requestA = gate.begin("auth:1|all");
    const requestB = gate.begin("auth:2|all");

    expect(requestA.controller.signal.aborted).toBe(true);
    expect(gate.accepts(requestA, "auth:1|all")).toBe(false);
    expect(gate.accepts(requestB, "auth:2|all")).toBe(true);
    expect(gate.accepts(requestB, "auth:1|all")).toBe(false);
  });

  it("restores each user's own sync cursor after A to B to A cache switches", () => {
    const cache = new AdminUserWorksCache<{ generations: Work[] }>({ ttlMs: 300_000, maxUsers: 10 });
    cache.set("auth:1|all", { generations: [] }, cursor(1), 1_000);
    cache.set("auth:2|all", { generations: [] }, cursor(2), 1_001);

    expect(cache.get("auth:2|all", 1_100)?.cursor).toEqual(cursor(2));
    expect(cache.get("auth:1|all", 1_100)?.cursor).toEqual(cursor(1));
  });

  it("does not build a changes request without a complete cursor", () => {
    expect(buildAdminWorksChangesQuery(null)).toBeNull();
    expect(buildAdminWorksChangesQuery({ updatedAt: "", id: 1 })).toBeNull();
    expect(buildAdminWorksChangesQuery({ updatedAt: "2026-07-16T00:00:00.000Z", id: -1 })).toBeNull();
    expect(buildAdminWorksChangesQuery({ updatedAt: "2026-07-16T00:00:00.000Z", id: 0 })?.get("sinceId")).toBe("0");
    expect(buildAdminWorksChangesQuery(cursor(3))?.toString()).toBe(
      "sinceUpdatedAt=2026-07-16T00%3A00%3A03.000Z&sinceId=3",
    );
    expect(buildAdminWorksChangesQuery({ ...cursor(3), sourceEventId: 77 })?.toString()).toBe(
      "sinceUpdatedAt=2026-07-16T00%3A00%3A03.000Z&sinceId=3&sinceSourceEventId=77",
    );
  });

  it("keeps the event cursor across consecutive incremental polls", () => {
    const first = parseAdminWorksCursor({
      updatedAt: "2026-07-16T00:00:00.000Z",
      id: 3,
      sourceEventId: 77,
    });
    const second = parseAdminWorksCursor({
      updatedAt: "2026-07-16T00:00:00.000Z",
      id: 3,
      sourceEventId: 78,
    });

    expect(buildAdminWorksChangesQuery(first)?.get("sinceSourceEventId")).toBe("77");
    expect(buildAdminWorksChangesQuery(second)?.get("sinceSourceEventId")).toBe("78");
  });

  it("starts polling only after the current user/filter scope finished loading", () => {
    const readyCursor = { updatedAt: "2026-07-16T12:00:00.000Z", id: 42 };

    expect(canStartAdminWorksPolling({
      activeAdminKey: "auth:2",
      typeFilter: "all",
      sourceFilter: "canvas",
      loadedScopeKey: "auth:1|all|canvas",
      payloadScopeKey: "auth:1",
      cursor: readyCursor,
    })).toBe(false);

    expect(canStartAdminWorksPolling({
      activeAdminKey: "auth:2",
      typeFilter: "all",
      sourceFilter: "canvas",
      loadedScopeKey: "auth:2|all|canvas",
      payloadScopeKey: "auth:2",
      cursor: readyCursor,
    })).toBe(true);
  });

  it("keeps initial and incremental request gates independent", () => {
    const initialGate = new AdminWorksRequestGate();
    const changesGate = new AdminWorksRequestGate();
    const initial = initialGate.begin("auth:2|all");

    changesGate.begin("auth:2|all");

    expect(initial.controller.signal.aborted).toBe(false);
    expect(initialGate.accepts(initial, "auth:2|all")).toBe(true);
  });

  it("keeps only the first 40 works after merging incoming records", () => {
    const current = Array.from({ length: 40 }, (_, index) => ({
      id: index + 1,
      createdAt: `2026-07-15T00:${String(index).padStart(2, "0")}:00.000Z`,
      finishedAt: `2026-07-15T00:${String(index).padStart(2, "0")}:30.000Z`,
      updatedAt: `2026-07-15T00:${String(index).padStart(2, "0")}:30.000Z`,
    }));
    const incoming = [{
      id: 100,
      createdAt: "2026-07-16T00:00:00.000Z",
      finishedAt: "2026-07-16T00:00:01.000Z",
      updatedAt: "2026-07-16T00:00:01.000Z",
    }];

    const merged = mergeAdminWorks(current, incoming, 40);

    expect(merged).toHaveLength(40);
    expect(merged[0]?.id).toBe(100);
    expect(merged.some((item) => item.id === 1)).toBe(false);
  });

  it("keeps every loaded page instead of truncating older works to the first 40", () => {
    const firstPage = Array.from({ length: 40 }, (_, index) => ({
      id: 80 - index,
      createdAt: `2026-06-09T00:${String(39 - index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-06-09T00:${String(39 - index).padStart(2, "0")}:00.000Z`,
    }));
    const secondPage = Array.from({ length: 40 }, (_, index) => ({
      id: 40 - index,
      createdAt: `2026-05-27T00:${String(39 - index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-05-27T00:${String(39 - index).padStart(2, "0")}:00.000Z`,
    }));

    const merged = appendAdminWorksPage(firstPage, secondPage);

    expect(merged).toHaveLength(80);
    expect(merged[0]?.id).toBe(80);
    expect(merged.at(-1)?.id).toBe(1);
  });

  it("appends an overlapping page without moving cards already being viewed", () => {
    const current: Work[] = [
      { id: 2, createdAt: "2026-09-29T10:00:00Z" },
      { id: 1, createdAt: "2026-09-29T09:00:00Z" },
    ];
    const incoming = [
      { id: 1, createdAt: "2026-09-29T09:00:00Z", finishedAt: "2026-09-29T11:00:00Z" },
      { id: 3, createdAt: "2026-09-28T09:00:00Z" },
    ];
    const appended = appendAdminWorksPage(current, incoming);
    expect(appended.map(item => item.id)).toEqual([2, 1, 3]);
    expect(appended[1].finishedAt).toBe(incoming[0].finishedAt);
  });

  it("does not retain thousands of browsed cards in inactive user caches", () => {
    const cache = new AdminUserWorksCache<{ generations: Work[] }>({ ttlMs: 300_000, maxUsers: 10, maxItems: 240 });
    const generations = Array.from({ length: 10000 }, (_, id) => ({ id, createdAt: "2026-09-29" }));
    cache.set("auth:1|all", { generations: generations.slice(0, 240) }, cursor(1), 1000);
    expect(cache.get("auth:1|all", 1001)?.payload.generations).toHaveLength(240);
    cache.set("auth:1|all", { generations }, cursor(1), 1002);
    expect(cache.get("auth:1|all", 1003)).toBeNull();
  });

  it("evicts the least recently used user and refreshes order on access", () => {
    const cache = new AdminUserWorksCache<{ value: number }>({ ttlMs: 300_000, maxUsers: 10 });
    for (let index = 1; index <= 10; index += 1) {
      cache.set(`auth:${index}|all`, { value: index }, cursor(index), 1_000 + index);
    }
    expect(cache.get("auth:1|all", 2_000)?.payload.value).toBe(1);

    cache.set("auth:11|all", { value: 11 }, cursor(11), 2_001);

    expect(cache.size).toBe(10);
    expect(cache.get("auth:1|all", 2_002)?.payload.value).toBe(1);
    expect(cache.get("auth:2|all", 2_002)).toBeNull();
  });

  it("counts multiple filters for one adminKey as one cached user", () => {
    const cache = new AdminUserWorksCache<{ value: number }>({ ttlMs: 300_000, maxUsers: 10 });
    cache.set("auth:1|all", { value: 1 }, cursor(1), 1_000);
    cache.set("auth:1|video", { value: 2 }, cursor(2), 1_001);

    expect(cache.size).toBe(1);
    expect(cache.get("auth:1|all", 1_100)?.payload.value).toBe(1);
    expect(cache.get("auth:1|video", 1_100)?.payload.value).toBe(2);
  });
  it("bounds one user's repeated date and filter caches as well as distinct users", () => {
    const cache = new AdminUserWorksCache<{ value: number }>({ ttlMs: 300_000, maxUsers: 10 });
    for(let index=0;index<100;index++) cache.set(`auth:1|all|range-${index}`,{value:index},cursor(1),1000+index);
    expect(cache.get('auth:1|all|range-0',2000)).toBeNull();
    expect(cache.get('auth:1|all|range-69',2000)).toBeNull();
    expect(cache.get('auth:1|all|range-70',2000)?.payload.value).toBe(70);
    expect(cache.get('auth:1|all|range-99',2000)?.payload.value).toBe(99);
  });

});
