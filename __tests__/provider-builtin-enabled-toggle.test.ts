import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("provider enabled toggle", () => {
  it("allows an administrator to enable a disabled builtin provider", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/admin/ProvidersPanel.tsx"),
      "utf8",
    );
    const handler = "const toggleProviderEnabled = (row: ProviderRow) => {";
    const handlerIndex = source.indexOf(handler);
    const patchIndex = source.indexOf("patch(row.id, { enabled: !row.enabled });", handlerIndex);
    const toggleIndex = source.indexOf("onClick={() => toggleProviderEnabled(row)}");

    expect(handlerIndex).toBeGreaterThan(-1);
    expect(patchIndex).toBeGreaterThan(handlerIndex);
    expect(toggleIndex).toBeGreaterThan(-1);
    expect(source.slice(handlerIndex, patchIndex)).not.toContain("!row.builtin");
  });
});
