import { describe, expect, it } from "vitest";
import { POST as createRun } from "@/app/api/agent/runs/route";
import { GET as readRun } from "@/app/api/agent/runs/[id]/route";
import { GET as readEvents } from "@/app/api/agent/runs/[id]/events/route";
import { POST as respond } from "@/app/api/agent/runs/[id]/responses/route";
import { POST as cancel } from "@/app/api/agent/runs/[id]/cancel/route";
import {
  GET as listConversations,
  POST as createConversation,
} from "@/app/api/agent/conversations/route";
import {
  PATCH as editConversation,
  DELETE as deleteConversation,
} from "@/app/api/agent/conversations/[id]/route";
import { GET as readMessages } from "@/app/api/agent/conversations/[id]/messages/route";
import { GET as catalog } from "@/app/api/agent/catalog/route";

describe("retired Agent workspace endpoints", () => {
  it.each([
    createRun,
    readRun,
    readEvents,
    respond,
    cancel,
    listConversations,
    createConversation,
    editConversation,
    deleteConversation,
    readMessages,
    catalog,
  ])(
    "returns stable retirement without executing the legacy runtime",
    async (handler) => {
      const response = handler(
        new Request("http://localhost/api/agent/legacy"),
        { params: { id: "untrusted-id" } },
      );
      expect(response.status).toBe(410);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(await response.json()).toMatchObject({
        success: false,
        code: "AGENT_RUNTIME_RETIRED",
      });
    },
  );
});
