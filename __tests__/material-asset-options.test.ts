import { describe, expect, it, vi } from "vitest";
import {
  mergeMaterialAssetOptionValues,
  listMaterialAssetOptionValues,
  upsertMaterialAssetOptions,
} from "@/lib/material-asset-options";

describe("material asset option fallback", () => {
  it("merges defaults, independent options and historical assets without writing", () => {
    expect(mergeMaterialAssetOptionValues({
      optionRows: [
        { kind: "category", value: " 净化器 " },
        { kind: "creator", value: "Alice" },
        { kind: "model", value: "Model  X" },
      ],
      assetRows: [
        { category: "按摩椅", creatorName: " Alice ", modelName: "Model   X" },
        { category: "新分类", creatorName: "Bob", modelName: null },
      ],
    })).toEqual({
      category: ["按摩椅", "净化器", "美容仪", "新分类"],
      creator: ["Alice", "Bob"],
      model: ["Model X"],
    });
  });

  it("keeps deleted candidates hidden when historical assets or defaults contain the same values", () => {
    expect(mergeMaterialAssetOptionValues({
      optionRows: [
        { kind: "category", value: "按摩椅", isDeleted: true },
        { kind: "creator", value: "Bob", isDeleted: true },
        { kind: "model", value: "M1", isDeleted: true },
      ],
      assetRows: [
        { category: "按摩椅", creatorName: "Bob", modelName: "M1" },
      ],
    })).toEqual({
      category: ["净化器", "美容仪"],
      creator: [],
      model: [],
    });
  });

  it("reads both sources and never mutates historical MaterialAsset rows", async () => {
    const client = {
      materialAssetOption: {
        findMany: vi.fn().mockResolvedValue([
          { kind: "creator", value: "Alice", isDeleted: false },
          { kind: "creator", value: "Bob", isDeleted: true },
        ]),
      },
      materialAsset: {
        findMany: vi.fn().mockResolvedValue([
          { category: "按摩椅", creatorName: "Bob", modelName: "M1" },
        ]),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    } as any;
    const result = await listMaterialAssetOptionValues(client);
    expect(result.creator).toEqual(["Alice"]);
    expect(client.materialAssetOption.findMany).toHaveBeenCalledWith({
      orderBy: [{ kind: "asc" }, { value: "asc" }],
      select: { kind: true, value: true, isDeleted: true },
    });
    expect(client.materialAsset.findMany).toHaveBeenCalledWith({
      where: { isDeleted: false },
      select: { category: true, creatorName: true, modelName: true },
    });
    expect(client.materialAsset.update).not.toHaveBeenCalled();
    expect(client.materialAsset.updateMany).not.toHaveBeenCalled();
  });

  it("restores a deleted candidate when the value is used in a new upload", async () => {
    const client = {
      materialAssetOption: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    } as any;

    await upsertMaterialAssetOptions(client, { creatorName: " Bob " });

    expect(client.materialAssetOption.upsert).toHaveBeenCalledWith({
      where: { kind_value: { kind: "creator", value: "Bob" } },
      create: { kind: "creator", value: "Bob", isDeleted: false },
      update: { isDeleted: false },
    });
  });
});
