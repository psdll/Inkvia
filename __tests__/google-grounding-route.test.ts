import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ default: { generation: { findFirst: mocks.find } } }));
import { GET } from "@/app/api/generation/[id]/grounding/route";
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue(7); });
it("returns only grounding from the authenticated owner's generation", async () => {
  const grounding = { renderedContent: "<div>Google</div>", sources: [{ title: "cat", url: "https://example.com" }] };
  mocks.find.mockResolvedValue({ templateData: JSON.stringify({ googleGrounding: grounding, unrelated: "private" }) });
  const result = await GET(new NextRequest("http://localhost/api/generation/12/grounding"), { params: { id: "12" } });
  expect(mocks.find).toHaveBeenCalledWith({ where: { id: 12, authUserId: 7 }, select: { templateData: true } });
  expect(await result.json()).toEqual({ grounding });
});
it("requires login before accessing generation data", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await GET(new NextRequest("http://localhost"), { params: { id: "12" } })).status).toBe(401);
  expect(mocks.find).not.toHaveBeenCalled();
});
it("does not expose other owners' data", async () => {
  mocks.find.mockResolvedValue(null);
  expect((await GET(new NextRequest("http://localhost"), { params: { id: "12" } })).status).toBe(404);
});
