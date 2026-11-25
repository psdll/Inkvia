import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: () => ({ ok: true, username: "admin" }) }));
vi.mock("@/lib/admin/user-export-runner", () => ({ enqueueUserExportJob: mocks.enqueue }));
import { POST } from "@/app/api/admin/user/export/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/user/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { mocks.enqueue.mockReset().mockResolvedValue("job-123"); });
describe("export archive mode boundary", () => {
  it("accepts the UI's data mode without forwarding a passphrase", async () => {
    const response = await POST(request({ userId: "alice", archiveMode: "data" }));
    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ userId: "alice", migrationPassphrase: undefined }));
  });
  it("defaults registered exports to portable with no passphrase", async () => {
    const response = await POST(request({ userId: "alice", authUserId: 7 }));
    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ portable: true, migrationPassphrase: undefined }));
    expect((await POST(request({ userId: "alice", archiveMode: "portable" }))).status).toBe(400);
  });
  it("requires an account and valid passphrase for migration mode", async () => {
    const short = "secret";
    expect((await POST(request({ userId: "alice", authUserId: 7, archiveMode: "migration", migrationPassphrase: short }))).status).toBe(400);
    expect((await POST(request({ userId: "alice", archiveMode: "migration", migrationPassphrase: "long enough passphrase" }))).status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    const response = await POST(request({ userId: "alice", authUserId: 7, archiveMode: "migration", migrationPassphrase: "long enough passphrase" }));
    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ migrationPassphrase: "long enough passphrase" }));
  });
});
