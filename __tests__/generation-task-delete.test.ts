import { describe, expect, it } from "vitest";
import { expandGenerationTaskDeleteRows } from "@/lib/generation-task-delete";

type Row = {
  id: number;
  userId: string | null;
  authUserId: number | null;
  type: string;
  externalTaskId: string | null;
};

function makeClient(rows: Row[]) {
  return {
    generation: {
      findMany: async ({ where }: any) => {
        if (Array.isArray(where?.OR)) {
          return rows.filter((row) => where.OR.some((scope: any) => (
            row.type === scope.type
            && row.externalTaskId === scope.externalTaskId
            && (scope.authUserId !== null
              ? row.authUserId === scope.authUserId
              : row.authUserId === null && row.userId === scope.userId)
          )));
        }
        const ids = new Set<number>(where?.id?.in || []);
        return rows.filter((row) => ids.has(row.id));
      },
    },
    imageBatchOutput: {
      findMany: async ({ where }: any) => {
        if (where?.generationId?.in) {
          const ids = new Set<number>(where.generationId.in);
          return ids.has(1) || ids.has(2) ? [{ itemId: "image-item-1" }] : [];
        }
        if (where?.itemId?.in?.includes("image-item-1")) {
          return [{ generationId: 1 }, { generationId: 2 }, { generationId: 3 }];
        }
        return [];
      },
    },
    liveVideoBatchOutput: {
      findMany: async ({ where }: any) => {
        if (where?.generationId?.in) {
          const ids = new Set<number>(where.generationId.in);
          return ids.has(3) ? [{ itemId: "live-item-1" }] : [];
        }
        if (where?.itemId?.in?.includes("live-item-1")) {
          return [{ generationId: 3 }, { generationId: 4 }];
        }
        return [];
      },
    },
  };
}

describe("expandGenerationTaskDeleteRows", () => {
  it("expands one selected generation to external-task and batch siblings", async () => {
    const rows: Row[] = [
      { id: 1, userId: "7", authUserId: 7, type: "image_edit", externalTaskId: "task-a" },
      { id: 2, userId: "7", authUserId: 7, type: "image_edit", externalTaskId: "task-a" },
      { id: 3, userId: "7", authUserId: 7, type: "image_edit", externalTaskId: "task-b" },
      { id: 4, userId: "7", authUserId: 7, type: "video_gen", externalTaskId: "task-c" },
      { id: 5, userId: "8", authUserId: 8, type: "image_edit", externalTaskId: "task-a" },
    ];

    const expanded = await expandGenerationTaskDeleteRows(makeClient(rows), [rows[0]], {
      select: { id: true },
      maxRows: 50,
    });

    expect(expanded.map((row) => row.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("does not cross user identity when external task ids collide", async () => {
    const rows: Row[] = [
      { id: 10, userId: "legacy-a", authUserId: null, type: "video_gen", externalTaskId: "same" },
      { id: 11, userId: "legacy-b", authUserId: null, type: "video_gen", externalTaskId: "same" },
    ];

    const expanded = await expandGenerationTaskDeleteRows(makeClient(rows), [rows[0]], {
      select: { id: true },
      maxRows: 50,
    });

    expect(expanded.map((row) => row.id)).toEqual([10]);
  });
});
