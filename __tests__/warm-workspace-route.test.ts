import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ models: vi.fn().mockResolvedValue({ models: [] }), mount: vi.fn() }));
vi.mock("@/lib/client/image-model-catalog", () => ({ loadImageModelCatalog: mocks.models }));
vi.mock("@/components/home/home-page-client", () => ({ default: mocks.mount }));
vi.mock("@/app/studio/page", () => ({ default: mocks.mount }));
vi.mock("@/app/image/image-tool", () => ({ default: mocks.mount }));
vi.mock("@/components/ui/prompt-rich-editor", () => ({ PromptRichEditor: mocks.mount }));
vi.mock("@/components/batch-workbench/batch-workbench-page", () => ({ BatchWorkbenchPage: mocks.mount }));
vi.mock("@/app/settings/page", () => ({ default: mocks.mount }));
import { FAST_WORKSPACE_ROUTES, warmWorkspaceRoute } from "@/lib/client/warm-workspace-route";

beforeEach(() => { vi.clearAllMocks(); });

it("prepares only the three requested routes and never mounts a tool or creates a draft", async () => {
  await warmWorkspaceRoute("/canvas");
  await warmWorkspaceRoute("/admin");
  await warmWorkspaceRoute("/");
  expect(mocks.models).not.toHaveBeenCalled();
  const studio = warmWorkspaceRoute("/studio?tool=image");
  expect(warmWorkspaceRoute("/studio")).toBe(studio);
  await Promise.all([studio, warmWorkspaceRoute("/batch-workbench")]);
  expect(mocks.models).toHaveBeenCalled();
  expect(mocks.mount).not.toHaveBeenCalled();
});

it("includes settings in idle preparation without mounting panels or fetching models", async () => {
  expect(FAST_WORKSPACE_ROUTES).toContain("/settings");
  await warmWorkspaceRoute("/settings");
  expect(mocks.mount).not.toHaveBeenCalled();
  expect(mocks.models).not.toHaveBeenCalled();
});
