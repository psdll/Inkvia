import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatFriendlyMessageForStorage,
  toFriendlyError,
} from "@/lib/error-friendly";
import { buildAdminModelReliability } from "@/lib/admin-model-reliability";

const now = new Date("2026-08-25T12:00:00+08:00");

function storedRawError(raw: string) {
  return formatFriendlyMessageForStorage(toFriendlyError(raw));
}

describe("admin platform model reliability", () => {
  it("builds inclusive today, recent three-day, and recent seven-day failure rates", () => {
    const result = buildAdminModelReliability(
      [
        {
          externalProvider: "volcengine",
          model: "seedance",
          type: "video_gen",
          status: "failed",
          errorMsg: storedRawError("upstream-code-a: actual provider error"),
          createdAt: "2026-08-25T01:00:00+08:00",
        },
        {
          externalProvider: "volcengine",
          model: "seedance",
          type: "video_gen",
          status: "success",
          errorMsg: null,
          createdAt: "2026-08-25T02:00:00+08:00",
        },
        {
          externalProvider: "kie",
          model: "veo",
          type: "video_gen",
          status: "success",
          errorMsg: null,
          createdAt: "2026-08-24T02:00:00+08:00",
        },
        {
          externalProvider: "tuzi",
          model: "flux",
          type: "image_edit",
          status: "failed",
          errorMsg: storedRawError("provider error from seven-day boundary"),
          createdAt: "2026-08-19T00:00:00+08:00",
        },
      ],
      now,
    );

    expect(result.periods.map((period) => period.key)).toEqual([
      "today",
      "last3Days",
      "last7Days",
    ]);
    expect(result.periods[0]).toMatchObject({
      failedCount: 1,
      completedCount: 2,
      failureRate: 50,
    });
    expect(result.periods[1]).toMatchObject({
      failedCount: 1,
      completedCount: 3,
      failureRate: 33.3,
    });
    expect(result.periods[2]).toMatchObject({
      failedCount: 2,
      completedCount: 4,
      failureRate: 50,
    });
    expect(result.periods[0].series).toHaveLength(13);
    expect(result.periods[1].series).toHaveLength(3);
    expect(result.periods[2].series).toHaveLength(7);
  });

  it("separates provider and model identities, keeps zero-failure and zero-call recent models, and excludes non-terminal rows", () => {
    const result = buildAdminModelReliability(
      [
        {
          externalProvider: "provider-a",
          model: "same-model",
          type: "video_gen",
          status: "failed",
          errorMsg: storedRawError("provider-a real failure"),
          createdAt: "2026-08-25T01:00:00+08:00",
        },
        {
          externalProvider: "provider-b",
          model: "same-model",
          type: "video_gen",
          status: "success",
          errorMsg: null,
          createdAt: "2026-08-25T02:00:00+08:00",
        },
        {
          externalProvider: "provider-c",
          model: "older-model",
          type: "image_edit",
          status: "success",
          errorMsg: null,
          createdAt: "2026-08-20T02:00:00+08:00",
        },
        {
          externalProvider: "ignored",
          model: "pending-model",
          type: "video_gen",
          status: "pending",
          errorMsg: null,
          createdAt: "2026-08-25T03:00:00+08:00",
        },
        {
          externalProvider: "ignored",
          model: "import-model",
          type: "import",
          status: "failed",
          errorMsg: storedRawError("ignored"),
          createdAt: "2026-08-25T04:00:00+08:00",
        },
      ],
      now,
    );

    const todayModels = result.periods[0].models;
    expect(todayModels).toContainEqual(
      expect.objectContaining({
        provider: "provider-a",
        model: "same-model",
        completedCount: 1,
        failedCount: 1,
        failureRate: 100,
      }),
    );
    expect(todayModels).toContainEqual(
      expect.objectContaining({
        provider: "provider-b",
        model: "same-model",
        completedCount: 1,
        failedCount: 0,
        failureRate: 0,
      }),
    );
    expect(todayModels).toContainEqual(
      expect.objectContaining({
        provider: "provider-c",
        model: "older-model",
        completedCount: 0,
        failedCount: 0,
        failureRate: null,
      }),
    );
    expect(
      todayModels.some(
        (row) => row.model === "pending-model" || row.model === "import-model",
      ),
    ).toBe(false);
  });

  it("aggregates only captured raw upstream errors and reports unavailable legacy details separately", () => {
    const exactRaw =
      "HTTP 400 | code=InvalidParameter | message=resolution 1080p is not supported";
    const result = buildAdminModelReliability(
      [
        {
          externalProvider: "provider-a",
          model: "model-a",
          type: "video_gen",
          status: "failed",
          errorMsg: storedRawError(exactRaw),
          createdAt: "2026-08-25T01:00:00+08:00",
        },
        {
          externalProvider: "provider-a",
          model: "model-a",
          type: "video_gen",
          status: "failed",
          errorMsg: storedRawError(exactRaw),
          createdAt: "2026-08-25T02:00:00+08:00",
        },
        {
          externalProvider: "provider-b",
          model: "model-b",
          type: "image_edit",
          status: "failed",
          errorMsg: "请求参数不符合接口要求。",
          createdAt: "2026-08-25T03:00:00+08:00",
        },
      ],
      now,
    );

    const today = result.periods[0];
    expect(today.errors).toEqual([
      expect.objectContaining({
        provider: "provider-a",
        rawError: exactRaw,
        count: 2,
      }),
    ]);
    expect(today.unavailableRawErrorCount).toBe(1);
    expect(today.errors[0].rawError).not.toContain("请求参数不符合接口要求");
  });

  it("wires a dedicated authenticated seven-day endpoint without expanding the storage endpoint", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "app/api/admin/model-reliability/route.ts"),
      "utf8",
    );

    expect(routeSource).toContain("requireAdminRequest");
    expect(routeSource).toContain("getAdminModelReliabilityWindowStart");
    expect(routeSource).toContain("adminModelCallSource()");
    expect(routeSource).toContain("status IN ('success', 'failed')");
    expect(routeSource).toContain('SELECT "externalProvider", model, type, status, "errorMsg", "createdAt"');
  });
});
