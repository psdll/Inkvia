import { describe, expect, it, vi } from "vitest";
import {
  DURABLE_TASK_MODELS,
  MaintenanceSubmissionError,
  createDurableTaskMaintenanceGuard,
  runGenerationCompletionCreate,
  runUserImportRestoreCreate,
} from "@/lib/maintenance";

describe("canvas Agent update admission", () => {
  it("declares the new durable run in the existing maintenance guard", () => {
    expect(DURABLE_TASK_MODELS).toContain("CreativeAgentRun");
    expect(DURABLE_TASK_MODELS).toContain("AgentRun");
  });

  it.each(["create", "createMany", "createManyAndReturn", "upsert"])(
    "blocks %s during maintenance without creating a new run",
    async (operation) => {
      const query = vi.fn(async () => "created");
      const guard = createDurableTaskMaintenanceGuard(vi.fn(async () => ({})));
      await expect(
        guard({ model: "CreativeAgentRun", operation, args: {}, query }),
      ).rejects.toBeInstanceOf(MaintenanceSubmissionError);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the maintenance sentinel cannot be read", async () => {
    const query = vi.fn(async () => "created");
    const guard = createDurableTaskMaintenanceGuard(
      vi.fn(async () => {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }),
    );
    await expect(
      guard({
        model: "CreativeAgentRun",
        operation: "create",
        args: {},
        query,
      }),
    ).rejects.toBeInstanceOf(MaintenanceSubmissionError);
    expect(query).not.toHaveBeenCalled();
  });

  it("allows an existing run to finish and admission when maintenance is absent", async () => {
    const query = vi.fn(async () => "done");
    const present = createDurableTaskMaintenanceGuard(vi.fn(async () => ({})));
    await expect(
      present({
        model: "CreativeAgentRun",
        operation: "update",
        args: {},
        query,
      }),
    ).resolves.toBe("done");
    const absent = createDurableTaskMaintenanceGuard(
      vi.fn(async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }),
    );
    await expect(
      absent({
        model: "CreativeAgentRun",
        operation: "create",
        args: {},
        query,
      }),
    ).resolves.toBe("done");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each([runGenerationCompletionCreate, runUserImportRestoreCreate])(
    "does not let unrelated completion/import scopes create canvas Agent work",
    async (scope) => {
      const query = vi.fn(async () => "created");
      const guard = createDurableTaskMaintenanceGuard(vi.fn(async () => ({})));
      await expect(
        scope(() =>
          guard({
            model: "CreativeAgentRun",
            operation: "create",
            args: {},
            query,
          }),
        ),
      ).rejects.toBeInstanceOf(MaintenanceSubmissionError);
      expect(query).not.toHaveBeenCalled();
    },
  );
});
