type AdminUserOrderItem = {
  adminKey: string;
};

export function reconcileStableUserOrder<T extends AdminUserOrderItem>(
  currentOrder: string[],
  rankedUsers: T[],
) {
  const availableKeys = new Set(rankedUsers.map((item) => item.adminKey));
  const nextOrder = currentOrder.filter((key) => availableKeys.has(key));
  const knownKeys = new Set(nextOrder);

  for (const item of rankedUsers) {
    if (knownKeys.has(item.adminKey)) continue;
    knownKeys.add(item.adminKey);
    nextOrder.push(item.adminKey);
  }

  return nextOrder;
}

export function orderUsersByStableKeys<T extends AdminUserOrderItem>(
  rankedUsers: T[],
  stableOrder: string[],
) {
  const userByKey = new Map(rankedUsers.map((item) => [item.adminKey, item]));
  return stableOrder
    .map((key) => userByKey.get(key))
    .filter((item): item is T => Boolean(item));
}

export function countUserOrderChanges<T extends AdminUserOrderItem>(
  visibleUsers: T[],
  rankedUsers: T[],
) {
  const visibleKeys = visibleUsers.map((item) => item.adminKey);
  return rankedUsers.reduce(
    (count, item, index) => count + (visibleKeys[index] === item.adminKey ? 0 : 1),
    0,
  );
}
