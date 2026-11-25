import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/works/page.tsx", "utf8").replace(/\r\n/g, "\n");
const loadSource = source.slice(
  source.indexOf("const load = React.useCallback"),
  source.indexOf("const loadMore = React.useCallback"),
);
const refreshButtonSource = source.slice(
  source.lastIndexOf("<button", source.indexOf('aria-label="刷新资产"')),
  source.indexOf("</button>", source.indexOf('aria-label="刷新资产"')),
);

describe("works refresh stability", () => {
  it("keeps the rendered assets and scroll position while a forced refresh is in flight", () => {
    expect(loadSource).toContain('} else if (!options.force) {');
    expect(loadSource).toContain('scrollRootRef.current?.scrollTo({ top: 0 });');
    expect(loadSource).toContain('else if (!options.background) setLoading(true);');
  });

  it("refreshes from the network without discarding the visible cache first", () => {
    expect(refreshButtonSource).not.toContain("worksPageCache.delete(requestKey)");
    expect(refreshButtonSource).not.toContain("clearStoredWorksCache");
    expect(refreshButtonSource).toContain("onClick={() => void load({ force: true })}");
  });

  it("refreshes only the newest page and merges it into the visible asset list", () => {
    expect(loadSource).toContain("let refreshedItems = normalized;");
    expect(loadSource).not.toContain("while (options.force && refreshedHasMore");
    expect(loadSource).toContain("refreshedItems = mergeWorksList(existing,");
    expect(loadSource).toContain("setItems(refreshedItems);");
  });

  it("keeps Virtuoso's footer component identity stable across refresh renders", () => {
    expect(source).toContain("const ASSET_VIRTUOSO_COMPONENTS");
    expect(source).toContain("components={ASSET_VIRTUOSO_COMPONENTS}");
    expect(source).toContain("context={{ footer: loadFooter }}");
    expect(source).not.toContain("components={{ Footer: () => loadFooter }}");
  });

  it("keeps the refresh icon spinning long enough to complete one turn", () => {
    expect(source).toContain("const WORKS_REFRESH_SPIN_MS = 600;");
    expect(loadSource).toContain("const refreshStartedAt = options.force && !options.background ? Date.now() : null;");
    expect(loadSource).toContain("WORKS_REFRESH_SPIN_MS - (Date.now() - refreshStartedAt)");
    expect(refreshButtonSource).toContain('loading ? "animate-[spin_600ms_linear_infinite]"');
  });
});
