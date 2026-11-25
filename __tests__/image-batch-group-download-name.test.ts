import { describe, expect, it } from "vitest";
import {
  batchGroupArchiveName,
  batchGroupOutputName,
  validateBatchGroupDownloadName,
} from "@/lib/image-batch/group-download-name";

describe("image batch group download names", () => {
  it("builds the archive and contiguous image names from a valid group name", () => {
    expect(validateBatchGroupDownloadName("松胜")).toBeNull();
    expect(batchGroupArchiveName("松胜")).toBe("松胜.zip");
    expect(batchGroupOutputName("松胜", 1, ".png")).toBe("松胜1.png");
    expect(batchGroupOutputName("松胜", 2, "jpg")).toBe("松胜2.jpg");
  });

  it.each([
    "",
    "   ",
    " 松胜",
    "松胜 ",
    "松/胜",
    "松\\胜",
    "松:胜",
    "松*胜",
    "松?胜",
    '松"胜',
    "松<胜",
    "松>胜",
    "松|胜",
    "松\u0001胜",
    "松胜.",
    ".",
    "..",
    "CON",
    "com1",
    "LPT9",
  ])("rejects an unsafe Windows filename: %j", (name) => {
    expect(validateBatchGroupDownloadName(name)).toEqual(expect.any(String));
  });

  it("reports the forbidden visible characters without changing the name", () => {
    expect(validateBatchGroupDownloadName("松胜:新品")).toBe(
      '分组名称不能包含 \\ / : * ? " < > |',
    );
  });
});
