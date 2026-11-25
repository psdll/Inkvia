import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  optionUpsert: vi.fn(),
  deleteStoredMediaRefs: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: mocks.requireAdminRequest,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    materialAsset: {
      findFirst: mocks.findFirst,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/media-cleanup", () => ({
  deleteStoredMediaRefs: mocks.deleteStoredMediaRefs,
}));

import { GET, PATCH } from "@/app/api/admin/material-assets/[id]/route";

const baseAsset = {
  id: 12,
  category: "按摩椅",
  title: "已有素材",
  imageUrl: "/uploads/material.jpg",
  thumbnailUrl: null,
  previewUrl: null,
  mimeType: "image/jpeg",
  sizeBytes: 128,
  media: null,
  mediaCount: 1,
  selectedMediaId: null,
  selectedByUserId: null,
  selectedByUser: null,
  selectedAt: null,
  tags: null,
  creatorName: null,
  modelName: "M616",
  inspiration: null,
  createdAt: new Date("2026-07-15T00:00:00.000Z"),
};

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/material-assets/12", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function formRequest(modelName: string) {
  const form = new FormData();
  form.set("modelName", modelName);
  return new Request("http://localhost/api/admin/material-assets/12", {
    method: "PATCH",
    body: form,
  }) as any;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
  mocks.findFirst.mockResolvedValue(baseAsset);
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...baseAsset,
    ...data,
  }));
  mocks.optionUpsert.mockResolvedValue({ id: 1 });
  mocks.transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
    materialAsset: {
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
    materialAssetOption: {
      upsert: mocks.optionUpsert,
    },
  }));
});

describe("admin material asset model editing", () => {
  it("returns the existing model from the detail endpoint", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/material-assets/12") as any,
      { params: { id: "12" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      item: { id: 12, modelName: "M616" },
    });
  });

  it("normalizes and saves a new model while adding it to the candidate library", async () => {
    const response = await PATCH(formRequest("  M626  "), { params: { id: "12" } });

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 12 },
      data: { modelName: "M626" },
    }));
    expect(mocks.optionUpsert).toHaveBeenCalledWith({
      where: { kind_value: { kind: "model", value: "M626" } },
      create: { kind: "model", value: "M626", isDeleted: false },
      update: { isDeleted: false },
    });
    await expect(response.json()).resolves.toMatchObject({
      item: { modelName: "M626" },
    });
  });

  it("clears a model to null without deleting or adding candidates", async () => {
    const response = await PATCH(formRequest("   "), { params: { id: "12" } });

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { modelName: null },
    }));
    expect(mocks.optionUpsert).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      item: { modelName: null },
    });
  });

  it("preserves the existing model when an older client omits modelName", async () => {
    const response = await PATCH(jsonRequest({ title: "新标题" }), { params: { id: "12" } });

    expect(response.status).toBe(200);
    const updateData = mocks.update.mock.calls[0][0].data;
    expect(updateData).toEqual({ title: "新标题" });
    expect(updateData).not.toHaveProperty("modelName");
    expect(mocks.optionUpsert).not.toHaveBeenCalled();
  });

  it("wires the existing themed model selector into the edit modal", () => {
    const source = readFileSync(resolve(process.cwd(), "app/admin/material-assets/page.tsx"), "utf8");
    const modal = source.slice(source.indexOf("function MaterialAssetEditModal"));

    expect(source).toContain("models={models}");
    expect(modal).toContain("models: string[];");
    expect(modal).toContain('React.useState(item.modelName || "")');
    expect(modal).toContain("<SuggestSelect");
    expect(modal).toContain("value={modelName}");
    expect(modal).toContain("options={models}");
    expect(modal).toContain('form.set("modelName", modelName)');
  });
});
