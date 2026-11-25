import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  resolve(process.cwd(), "components/batch-workbench/batch-workbench-page.tsx"),
  "utf8",
);

describe("batch workbench result reveal", () => {
  it("reveals the active surface when ready and announces other results still loading", () => {
    const shell = page.slice(page.indexOf("export function BatchWorkbenchPage()"));
    const resultShellStart = shell.indexOf('data-batch-unified-result-shell="true"');
    const resultShell = shell.slice(resultShellStart, shell.indexOf("</section>", resultShellStart));

    expect(shell).toMatch(
      /const resultsReady\s*=\s*modeResolved\s*&&\s*readySurfaces\.has\(displayedSurface\);/,
    );
    expect(resultShell).toMatch(
      /\{resultsReady\s*\?\s*\([\s\S]*?<UnifiedBatchResults\s*\/>[\s\S]*?:\s*\(\s*<BatchWorkbenchSkeleton\s+embedded\s*\/>\s*\)\}/,
    );
    expect(resultShell).toContain('readySurfaces.size < 2');
    expect(resultShell).toContain('正在加载其他任务');
  });
});
