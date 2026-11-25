import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ canvas: vi.fn(), session: vi.fn(), access: vi.fn(), setting: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: mocks.setting } } }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: { getSession: mocks.session } }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentCanvas: mocks.access }));
vi.mock("@/lib/creative-agent/canvas-tools", async original => ({ ...await original<any>(), readCreativeAgentCanvas: mocks.canvas }));
import { readCreativeProject } from "@/lib/creative-agent/project-state";
import { creativeAgentNodeHash } from "@/lib/creative-agent/canvas-tools";
beforeEach(() => { vi.resetAllMocks(); });
it("prepares only adopted/confirmed source nodes and preserves dependency invalidation and shared constraints", async () => {
  const node: any = { id: "kept", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "saved" } };
  const project = { version: 1, revision: 4, constraints: ["portrait"], updatedAt: null, artifacts: [
    { id: "a", nodeId: "kept", status: "adopted", semanticHash: creativeAgentNodeHash(node), dependencies: [], title: "saved" },
    { id: "b", nodeId: "missing", status: "confirmed", semanticHash: "gone", dependencies: [], title: "missing" },
    { id: "c", nodeId: "kept", status: "adopted", semanticHash: creativeAgentNodeHash(node), dependencies: ["b"], title: "dependent" },
    { id: "d", nodeId: "revoked", status: "revoked", dependencies: [], title: "revoked" },
  ] };
  mocks.setting.mockImplementation(async ({where}) => where.key.includes(":project:") ? { value: JSON.stringify(project) } : null);
  mocks.canvas.mockResolvedValue({ nodes: [node], edges: [] });
  const result = await readCreativeProject(7, 2, "s", undefined, false);
  expect(mocks.access).toHaveBeenCalledWith(7, 2); expect(mocks.session).toHaveBeenCalledWith(7, 2, "s");
  expect(mocks.canvas).toHaveBeenCalledWith(7, 2, ["kept", "missing"]);
  expect(result.project).toEqual(project); expect(result.candidates).toEqual([]);
  expect(result.changes.map(c => c.artifactId)).toEqual(["b", "c"]);
});
it("an empty project requests no candidate nodes", async () => {
  mocks.setting.mockResolvedValue(null); mocks.canvas.mockResolvedValue({ nodes: [], edges: [] });
  expect((await readCreativeProject(7, 2, "s", undefined, false)).project.constraints).toEqual([]);
  expect(mocks.canvas).toHaveBeenCalledWith(7, 2, []);
});
