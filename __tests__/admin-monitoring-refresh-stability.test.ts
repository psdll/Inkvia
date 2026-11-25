import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("administrator monitoring refresh stability", () => {
  it("keeps the existing error banner mounted while a background refresh is in flight", () => {
    const panel = read("components/admin/monitoring/AdminMonitoringPanel.tsx");
    const refresh = panel.slice(
      panel.indexOf("const refresh = React.useCallback"),
      panel.indexOf("React.useImperativeHandle"),
    );

    const beforeRequests = refresh.slice(0, refresh.indexOf("try {"));
    expect(beforeRequests).not.toContain("setError(null)");
    expect(refresh).toMatch(/if \(Object\.keys\(nextMetricErrors\)\.length > 0\)[\s\S]*?} else \{\s+setError\(null\);/);
    expect(refresh).toMatch(/setMetricErrors\(\{\}\);\s+setError\(null\);/);
  });
});
