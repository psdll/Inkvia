import { describe, expect, it } from "vitest";
import { parseImportAccountOptions } from "@/lib/admin/user-migration-contracts";

describe("import account option boundary", () => {
  it("accepts valid retry options without changing secret bytes", () => {
    const options = parseImportAccountOptions({
      migrationPassphrase: "  abcdefghij  ",
      newPassword: "abcd",
      mergeTargetUserId: 42,
      ignored: "not forwarded",
    });
    expect(options).toEqual({
      migrationPassphrase: "  abcdefghij  ",
      newPassword: "abcd",
      mergeTargetUserId: 42,
    });
  });

  it.each([
    ["missing object", null],
    ["short passphrase", { migrationPassphrase: "a".repeat(11) }],
    ["long passphrase", { migrationPassphrase: "a".repeat(257) }],
    ["short password", { newPassword: "abc" }],
    ["long password", { newPassword: "a".repeat(257) }],
    ["string target", { mergeTargetUserId: "42" }],
    ["fractional target", { mergeTargetUserId: 1.5 }],
    ["unsafe target", { mergeTargetUserId: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects %s with an error that omits the value", (_label, input) => {
    expect(() => parseImportAccountOptions(input)).toThrow();
    try {
      parseImportAccountOptions(input);
    } catch (error) {
      expect(String(error)).not.toContain("aaaaaaaaaaaa");
    }
  });
});
