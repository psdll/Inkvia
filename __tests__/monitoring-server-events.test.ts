import { describe, expect, it } from "vitest";

import {
  buildServerEventsOpsPath,
  parseServerEventQuery,
  sanitizeServerEventsPayload,
} from "@/lib/monitoring/server-events";

describe("server event contracts", () => {
  it("defaults to seven days and applies fixed filters", () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");

    const query = parseServerEventQuery(new URLSearchParams(), now);

    expect(query).toMatchObject({
      category: "all",
      severity: "all",
      state: "all",
      limit: 100,
    });
    expect(query.to - query.from).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it.each([
    "category=shell",
    "severity=debug",
    "state=deleted",
    "limit=501",
    "limit=0",
    "unit=ssh.service",
    "limit=20&limit=30",
    "from=0&to=9999999999999",
    "from=1783814400000&to=1786579200000",
  ])("rejects unsafe query %s", (raw) => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    expect(() => parseServerEventQuery(new URLSearchParams(raw), now)).toThrow();
  });

  it("builds only the canonical Ops query path", () => {
    const query = parseServerEventQuery(new URLSearchParams(
      "from=1786492800000&to=1786579200000&category=power&severity=warning&state=active&limit=20",
    ), Date.parse("2026-08-13T00:00:00.000Z"));

    expect(buildServerEventsOpsPath(query)).toBe(
      "/v1/server-events?from=1786492800&to=1786579200&category=power&severity=warning&state=active&limit=20",
    );
  });

  it("sanitizes bounded DTO fields and redacts evidence", () => {
    const payload = {
      observedAt: "2026-08-12T11:59:59.000Z",
      history: {
        state: "partial",
        availableFrom: "2026-08-10T00:00:00.000Z",
        reason: "history-starts-later",
      },
      events: [{
        id: "a".repeat(64),
        occurredAt: "2026-08-12T11:00:00.000Z",
        category: "power",
        severity: "warning",
        state: "historical",
        title: "服务器疑似异常关机",
        summary: "上一次启动没有找到正常关机证据。",
        impact: "停机期间项目不可用。",
        evidence: [{ label: "启动标识", value: "token=top-secret-value" }],
      }],
    };

    const result = sanitizeServerEventsPayload(payload, {
      now: Date.parse("2026-08-12T12:00:00.000Z"),
      from: Date.parse("2026-08-05T12:00:00.000Z"),
      to: Date.parse("2026-08-12T12:00:00.000Z"),
      limit: 100,
    });

    expect(result.events).toHaveLength(1);
    expect(result.history).toEqual({
      state: "partial",
      availableFrom: "2026-08-10T00:00:00.000Z",
      reason: "history-starts-later",
    });
    expect(result.events[0].evidence[0].value).not.toContain("top-secret-value");
  });

  it("rejects missing or fabricated history coverage", () => {
    const options = {
      now: Date.parse("2026-08-12T12:00:00.000Z"),
      from: Date.parse("2026-08-05T12:00:00.000Z"),
      to: Date.parse("2026-08-12T12:00:00.000Z"),
      limit: 100,
    };
    const base = { observedAt: "2026-08-12T11:59:59.000Z", events: [] };

    expect(() => sanitizeServerEventsPayload(base, options)).toThrow();
    expect(() => sanitizeServerEventsPayload({
      ...base,
      history: { state: "complete", availableFrom: null, reason: "complete" },
    }, options)).toThrow();
    expect(() => sanitizeServerEventsPayload({
      ...base,
      history: { state: "complete", availableFrom: "2026-08-10T00:00:00.000Z", reason: "complete" },
    }, options)).toThrow();
    expect(() => sanitizeServerEventsPayload({
      ...base,
      history: { state: "partial", availableFrom: "2026-08-10T00:00:00.000Z", reason: "guessed" },
    }, options)).toThrow();
  });

  it("accepts complete coverage from the current boot", () => {
    const result = sanitizeServerEventsPayload({
      observedAt: "2026-08-12T11:59:59.000Z",
      history: {
        state: "complete",
        availableFrom: "2026-08-01T00:00:00.000Z",
        reason: "complete",
      },
      events: [],
    }, {
      now: Date.parse("2026-08-12T12:00:00.000Z"),
      from: Date.parse("2026-08-05T12:00:00.000Z"),
      to: Date.parse("2026-08-12T12:00:00.000Z"),
      limit: 100,
    });

    expect(result.history.state).toBe("complete");
  });

  it("rejects duplicate IDs, unknown services, and events outside the query window", () => {
    const base = {
      id: "b".repeat(64),
      occurredAt: "2026-08-12T11:00:00.000Z",
      category: "service",
      severity: "critical",
      state: "active",
      title: "生成任务服务启动失败",
      summary: "固定服务进入 failed 状态。",
      impact: "生成任务暂停。",
      evidence: [],
    };
    const options = {
      now: Date.parse("2026-08-12T12:00:00.000Z"),
      from: Date.parse("2026-08-05T12:00:00.000Z"),
      to: Date.parse("2026-08-12T12:00:00.000Z"),
      limit: 100,
    };

    expect(() => sanitizeServerEventsPayload({
      observedAt: "2026-08-12T11:59:59.000Z",
      history: { state: "complete", availableFrom: "2026-08-01T00:00:00.000Z", reason: "complete" },
      events: [base, base],
    }, options)).toThrow();
    expect(() => sanitizeServerEventsPayload({
      observedAt: "2026-08-12T11:59:59.000Z",
      history: { state: "complete", availableFrom: "2026-08-01T00:00:00.000Z", reason: "complete" },
      events: [{ ...base, affectedService: "arbitrary.service" }],
    }, options)).toThrow();
    expect(() => sanitizeServerEventsPayload({
      observedAt: "2026-08-12T11:59:59.000Z",
      history: { state: "complete", availableFrom: "2026-08-01T00:00:00.000Z", reason: "complete" },
      events: [{ ...base, occurredAt: "2026-08-01T11:00:00.000Z" }],
    }, options)).toThrow();
  });
});
