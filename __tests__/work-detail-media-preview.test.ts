import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "components/works/work-detail-modal.tsx"),
  "utf8",
);
const lightboxSource = readFileSync(
  resolve(process.cwd(), "components/ui/media-lightbox.tsx"),
  "utf8",
);

describe("work detail media preview", () => {
  it("shows an explicit zoom affordance on previewable media", () => {
    expect(source).toMatch(/import \{[^}]*ZoomIn[^}]*\} from "lucide-react"/);
    expect(source).toContain("group-hover:opacity-100");
    expect(source).toContain('<ZoomIn className="h-4 w-4" />');
    expect(source).toContain("aria-label={`查看${label}`}");
  });

  it("opens input and output media as independently navigable groups", () => {
    expect(source).toContain("const [zoomPreview, setZoomPreview]");
    expect(source).toContain("openZoom(inputImages, i, modeInfo.uploadTitle)");
    expect(source).toContain('openZoom(outputPaths, i, "生成结果")');
    expect(source).toContain('layout="floating"');
    expect(source).toContain("zoomPreview.index + 1");
    expect(source).toContain(
      "hasPrev={Boolean(zoomPreview && zoomPreview.index > 0)}",
    );
    expect(source).toContain("onPrev={() =>");
    expect(source).toContain("onNext={() =>");
  });

  it("fits floating videos inside the available lightbox area without cropping", () => {
    expect(lightboxSource).toContain(
      'isFloatingLayout ? "h-full w-full" : ""',
    );
    expect(lightboxSource).toContain(
      '? "h-full w-full max-h-full max-w-full"',
    );
  });
});
