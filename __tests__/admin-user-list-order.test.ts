import { describe, expect, it } from "vitest";
import {
  countUserOrderChanges,
  orderUsersByStableKeys,
  reconcileStableUserOrder,
} from "../lib/admin-user-list-order";

type TestUser = {
  adminKey: string;
  value: number;
};

const users = (...keys: string[]): TestUser[] =>
  keys.map((adminKey, value) => ({ adminKey, value }));

describe("admin user list stable order", () => {
  it("keeps the visible order when background ranking changes", () => {
    const currentOrder = ["a", "b", "c"];
    const nextRanking = users("c", "a", "b");

    const stableOrder = reconcileStableUserOrder(currentOrder, nextRanking);
    const visibleUsers = orderUsersByStableKeys(nextRanking, stableOrder);

    expect(stableOrder).toEqual(["a", "b", "c"]);
    expect(visibleUsers.map((item) => item.adminKey)).toEqual(["a", "b", "c"]);
    expect(countUserOrderChanges(visibleUsers, nextRanking)).toBe(3);
  });

  it("appends newly discovered users without shifting existing rows", () => {
    const currentOrder = ["a", "b"];
    const nextRanking = users("c", "a", "b");

    expect(reconcileStableUserOrder(currentOrder, nextRanking)).toEqual(["a", "b", "c"]);
  });

  it("removes deleted users while preserving the remaining order", () => {
    const currentOrder = ["a", "b", "c"];
    const nextRanking = users("c", "a");

    expect(reconcileStableUserOrder(currentOrder, nextRanking)).toEqual(["a", "c"]);
  });
});
