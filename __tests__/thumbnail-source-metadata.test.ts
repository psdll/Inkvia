import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ metadata: vi.fn(), stat: vi.fn() }));
vi.mock("sharp", () => ({ default: () => ({ metadata: mocks.metadata }) }));
vi.mock("fs-extra", () => ({ default: { stat: mocks.stat } }));
import { GET } from "@/app/api/thumb/route";

const request = (src = "/uploads/source.jpg", width = 200) => GET(new NextRequest(`http://localhost/api/thumb?src=${encodeURIComponent(src)}&w=${width}&metadata=1`));
beforeEach(() => {
  mocks.stat.mockReset().mockResolvedValue({ isFile: () => true });
  mocks.metadata.mockReset().mockResolvedValue({ width: 1536, height: 2752 });
});
describe("source dimensions from thumbnail service", () => {
  it("returns the original dimensions regardless of requested thumbnail size", async () => {
    for (const width of [100, 400, 1600]) expect(await (await request(undefined, width)).json()).toEqual({ width: 1536, height: 2752 });
  });
  it("honors image orientation and animated frame height", async () => {
    mocks.metadata.mockResolvedValueOnce({ width: 4000, height: 3000, orientation: 6 });
    expect(await (await request()).json()).toEqual({ width: 3000, height: 4000 });
    mocks.metadata.mockResolvedValueOnce({ width: 800, height: 6000, pageHeight: 600 });
    expect(await (await request()).json()).toEqual({ width: 800, height: 600 });
  });
  it.each(["/uploads/../private.jpg", "/private.jpg", "https://external.test/image.jpg"])("preserves path validation for %s", async src => {
    expect((await request(src)).status).toBe(400);
    expect(mocks.metadata).not.toHaveBeenCalled();
  });
  it("reports unavailable source files and invalid image headers", async () => {
    mocks.stat.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(404);
    mocks.metadata.mockRejectedValueOnce(new Error("invalid image"));
    expect((await request()).status).toBe(422);
  });
});
