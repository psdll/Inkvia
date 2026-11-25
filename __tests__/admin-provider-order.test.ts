import { describe, expect, it } from "vitest";
import { ADMIN_PROVIDER_ORDER, sortAdminProviders } from "@/lib/providers/order";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { sanitizeProviderAdminInput } from "@/lib/providers/admin-config";

describe("shared admin provider order", () => {
  it("uses the price-page baseline regardless of old saved positions or names", () => {
    const input = [...ADMIN_PROVIDER_ORDER].reverse().map((id, sortOrder) => ({ id, name: `${sortOrder}`, sortOrder }));
    expect(sortAdminProviders(input).map(p => p.id)).toEqual(ADMIN_PROVIDER_ORDER);
    expect(input[0].id).toBe("jiekou");
    expect(mergeSavedProvidersWithBuiltins(getBuiltinProviders().reverse()).map(p => p.id)).toEqual(ADMIN_PROVIDER_ORDER);
  });

  it("appends new platforms after defaults and previously added platforms", () => {
    const create = (id: string, name: string) => ({ id, name, baseUrl: "https://example.test/v1", sortOrder: -100 });
    const [first] = sanitizeProviderAdminInput([create("custom-zulu", "Zulu")], []);
    const [kept, second] = sanitizeProviderAdminInput([first, create("custom-alpha", "Alpha")], [first]);
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
    const result = mergeSavedProvidersWithBuiltins([second, kept]);
    expect(result.map(p => p.id)).toEqual([...ADMIN_PROVIDER_ORDER, first.id, second.id]);
    expect(sortAdminProviders(result.filter(p => p.id !== "jiekou")).map(p => p.id)).toEqual(result.filter(p => p.id !== "jiekou").map(p => p.id));
  });
});
