import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("media lightbox zoom boundary", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "components/ui/media-lightbox.tsx"),
    "utf8",
  );

  it("keeps the toolbar above a clipped media stage", () => {
    expect(source).toContain(
      '"z-20 flex h-[56px] shrink-0 items-center justify-between',
    );
    expect(source).toContain('isMaterialDetailLayout ? "absolute inset-x-0 top-0" : "relative"');
    expect(source).toContain(
      '"group relative min-h-0 min-w-0 flex-1 overflow-hidden"',
    );
  });

  it("keeps the current transform when a parent refreshes its close callback", () => {
    expect(source).toContain("const onCloseRef = React.useRef(onClose);");
    expect(source).toContain("onCloseRef.current = onClose;");
    expect(source).toContain("onCloseRef.current();");
    expect(source).not.toContain("}, [onClose, resetTransform]);");
  });
});
