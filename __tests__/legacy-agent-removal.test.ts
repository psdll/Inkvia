import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET as runtimeHealth } from "@/app/api/admin/agent-runtime/route";
import { GET as records } from "@/app/api/admin/user/agent/route";
import { GET as conversation, DELETE as deleteConversation } from "@/app/api/admin/user/agent/conversations/[id]/route";
import { GET as memory, DELETE as deleteMemory } from "@/app/api/admin/user/agent/memory/route";
import { isPublicExport } from "./support/public-export";

describe("legacy Agent removal boundary", () => {
  it.each([runtimeHealth, records, conversation, deleteConversation, memory, deleteMemory])(
    "rejects stale admin clients without exposing or changing historical data",
    async (handler) => {
      const response = handler(new Request("http://localhost/retired"), { params: { id: "1" } });
      expect(response.status).toBe(410);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(await response.json()).toMatchObject({ code: "AGENT_RUNTIME_RETIRED" });
    },
  );

  it("removes the legacy implementation while keeping the current canvas entry and worker", () => {
    expect(existsSync("lib/agent")).toBe(false);
    expect(existsSync("components/agent")).toBe(false);
    expect(existsSync("app/agent/page.tsx")).toBe(false);
    expect(readFileSync("components/canvas/CanvasEditorPage.tsx", "utf8")).toContain("@/components/creative-agent/CanvasAgentPanel");
    expect(readFileSync("lib/server-bootstrap.ts", "utf8")).toContain("@/lib/creative-agent/worker");
  });

  it("keeps account archive compatibility independent of generation and Agent execution", () => {
    for (const file of readdirSync("lib/admin/legacy-agent-data")) {
      const source = readFileSync(`lib/admin/legacy-agent-data/${file}`, "utf8");
      expect(source, file).not.toMatch(/from ["'][^"']*(?:image-service|video-service|run-executor|runtime-attempts|llm-client|creative-agent)/);
    }
    for (const file of ["prisma/schema.prisma", ...(isPublicExport ? [] : ["config/deploy/data-protection.json"])]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("AgentMemoryProfile");
      expect(source).toContain("CreativeAgentRun");
    }
  });
});
