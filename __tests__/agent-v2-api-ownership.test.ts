import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));

import { GET as getRun } from "@/app/api/agent/runs/[id]/route";
import { POST as cancelRun } from "@/app/api/agent/runs/[id]/cancel/route";
import { POST as respondToRun } from "@/app/api/agent/runs/[id]/responses/route";

describe("retired Agent V2 API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the same retirement status for valid and foreign run IDs without reading or mutating records", async () => {
    for (const id of ["21", "99"]) {
      const responses = await Promise.all([
        getRun(new Request(`http://localhost/api/agent/runs/${id}`), {
          params: { id },
        }),
        cancelRun(
          new Request(`http://localhost/api/agent/runs/${id}/cancel`, {
            method: "POST",
          }),
          { params: { id } },
        ),
        respondToRun(
          new Request(`http://localhost/api/agent/runs/${id}/responses`, {
            method: "POST",
            body: JSON.stringify({ content: "test" }),
          }),
          { params: { id } },
        ),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({
          code: "AGENT_RUNTIME_RETIRED",
        });
      }
    }
    expect(mocks.getUserId).not.toHaveBeenCalled();
  });
});
