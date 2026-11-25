import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { canvas: { findFirst: mocks.findFirst } } }));
vi.mock("@/components/canvas/CanvasEditorPage", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
import CanvasEditorRoute from "@/app/canvas/[id]/page";

const publicId = "dc7c2098ed2049c7b15e6f8c0f55f342";
const open = (id: string, searchParams = {}) => Promise.resolve().then(() => CanvasEditorRoute({ params: { id }, searchParams } as any));

describe("canvas public URL identifiers", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.findFirst.mockResolvedValue({ id: 59, publicId });
    mocks.notFound.mockImplementation(() => { throw new Error("NOT_FOUND"); });
    mocks.redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });
  });

  it("resolves the public identifier to the existing internal canvas identity", async () => {
    const page = await open(publicId);
    expect(page.props.canvasId).toBe(59);
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { publicId, deletedAt: null, data: { path: ["mode"], equals: "smart" } }, select: { id: true, publicId: true } });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects old numeric links without losing query parameters", async () => {
    await expect(open("59", { node: "image one", tag: ["a", "b"] })).rejects.toThrow(`REDIRECT:/canvas/${publicId}?node=image+one&tag=a&tag=b`);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 59, deletedAt: null }) }));
  });

  it("canonicalizes uppercase UUIDs", async () => {
    await expect(open(publicId.toUpperCase())).rejects.toThrow(`REDIRECT:/canvas/${publicId}`);
  });

  it.each(["0", "-1", "1e3", "2147483648", "unknown", "g".repeat(32)])("rejects malformed identifier %s without querying a canvas", async id => {
    await expect(open(id)).rejects.toThrow("NOT_FOUND");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("returns not found for an unknown or deleted canvas", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(open(publicId)).rejects.toThrow("NOT_FOUND");
  });

  it("keeps different public identifiers attached to different internal documents", async () => {
    const other = "ee2190941bd14edaaa19adfc636b9a46";
    mocks.findFirst.mockImplementation(async ({ where }) => where.publicId === publicId ? { id: 59, publicId } : { id: 60, publicId: other });
    expect((await open(publicId)).props.canvasId).toBe(59);
    expect((await open(other)).props.canvasId).toBe(60);
  });
});
