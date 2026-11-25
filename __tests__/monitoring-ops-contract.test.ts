import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  OPS_ACTIONS,
  isOpsAction,
  normalizeIdempotencyKey,
} from "@/lib/monitoring/ops-actions";
import {
  OPS_STATUS_SERVICE_IDS,
  createOpsRequestSignature,
  sanitizeOpsStatusPayload,
} from "@/lib/monitoring/ops-client";

describe("controlled monitoring operations contract", () => {
  it("contains only the explicitly approved operation enums", () => {
    expect(OPS_ACTIONS).toEqual([
      "web.start",
      "web.stop",
      "web.restart",
      "canvas-generation.start",
      "canvas-generation.stop",
      "canvas-generation.restart",
      "canvas-media.start",
      "canvas-media.stop",
      "canvas-media.restart",
      "live-video-prompt.start",
      "live-video-prompt.stop",
      "live-video-prompt.restart",
      "live-video-video.start",
      "live-video-video.stop",
      "live-video-video.restart",
      "prometheus.start",
      "prometheus.stop",
      "prometheus.restart",
      "loki.start",
      "loki.stop",
      "loki.restart",
      "alloy.start",
      "alloy.stop",
      "alloy.restart",
      "nginx.check",
      "nginx.reload",
      "logs.rotate",
    ]);
    expect(isOpsAction("postgresql.restart")).toBe(false);
    expect(isOpsAction("server.reboot")).toBe(false);
    expect(isOpsAction("shell")).toBe(false);
  });

  it("accepts bounded UUID idempotency keys only", () => {
    expect(normalizeIdempotencyKey("550e8400-e29b-41d4-a716-446655440000"))
      .toBe("550e8400-e29b-41d4-a716-446655440000");
    for (const value of ["", "../key", "key with spaces", "a".repeat(129)]) {
      expect(() => normalizeIdempotencyKey(value)).toThrow();
    }
  });

  it("signs method, fixed path, body digest, timestamp, and nonce", () => {
    expect(createOpsRequestSignature({
      method: "POST",
      path: "/v1/operations",
      body: '{"action":"web.restart"}',
      timestamp: "1753660800",
      nonce: "00112233445566778899aabbccddeeff",
      secret: "0123456789abcdef0123456789abcdef",
    })).toEqual({
      bodySha256: "26c28f01ea2b2eff5a638aba01de62ba7e3a870cdc5b0485fcbfd3f7fa486a45",
      signature: "5c8c9bc7699d69d563083f190c3e373230d5577648bce51b645f7125b7af7ce8",
    });
  });

  it("binds server event filters into the signed canonical path", () => {
    const path = "/v1/server-events?from=1786492800&to=1786579200&category=power&severity=warning&state=active&limit=20";

    const first = createOpsRequestSignature({
      method: "GET",
      path,
      body: "",
      timestamp: "1786579200",
      nonce: "00112233445566778899aabbccddeeff",
      secret: "0123456789abcdef0123456789abcdef",
    });
    const changed = createOpsRequestSignature({
      method: "GET",
      path: path.replace("limit=20", "limit=21"),
      body: "",
      timestamp: "1786579200",
      nonce: "00112233445566778899aabbccddeeff",
      secret: "0123456789abcdef0123456789abcdef",
    });

    expect(first.signature).not.toBe(changed.signature);
  });

  it("keeps browser action routes free of service names, paths, commands, Shell, and SQL", () => {
    const source = readFileSync(
      join(process.cwd(), "app", "api", "admin", "monitoring", "v1", "actions", "route.ts"),
      "utf8",
    );

    expect(source).toContain("isOpsAction");
    expect(source).toContain("normalizeIdempotencyKey");
    expect(source).not.toMatch(/body\?\.(service|unit|path|command|shell|sql)/i);
    expect(source).not.toMatch(/child_process|exec\(|spawn\(/);
  });

  it("uses the fixed Unix socket and never launches a process from Next.js", () => {
    const source = readFileSync(join(process.cwd(), "lib", "monitoring", "ops-client.ts"), "utf8");
    const services = readFileSync(
      join(process.cwd(), "app", "api", "admin", "monitoring", "v1", "services", "route.ts"),
      "utf8",
    );

    expect(source).toContain("/run/inkvia-ops/ops.sock");
    expect(source).toContain("createHmac");
    expect(source).toContain("timingSafeEqual");
    expect(source).toContain("MAX_RESPONSE_BYTES");
    expect(source).not.toMatch(/child_process|exec\(|spawn\(/);
    expect(services).toContain("readOpsStatus");
    expect(services).toContain('"unavailable"');
  });

  it("keeps server event reads on the fixed Ops socket and bounded filters", () => {
    const source = readFileSync(join(process.cwd(), "lib", "monitoring", "ops-client.ts"), "utf8");
    const route = readFileSync(
      join(process.cwd(), "app", "api", "admin", "monitoring", "v1", "server-events", "route.ts"),
      "utf8",
    );

    expect(source).toContain("buildServerEventsOpsPath");
    expect(source).toContain("sanitizeServerEventsPayload");
    expect(source).toContain("SERVER_EVENTS_REQUEST_TIMEOUT_MS");
    expect(source).toContain('requestOps<unknown>("GET", path, undefined, SERVER_EVENTS_REQUEST_TIMEOUT_MS)');
    expect(route).toContain("parseServerEventQuery");
    expect(route).toContain("readOpsServerEvents");
    expect(route).not.toMatch(/child_process|journalctl|exec\(|spawn\(/);
    expect(route).not.toMatch(/searchParams\.get\(["'](unit|path|command|field)["']\)/i);
  });

  it("requires one fresh, valid status for every expected production service", () => {
    const now = Date.parse("2026-07-28T08:00:00.000Z");
    const payload = {
      observedAt: "2026-07-28T07:59:55.000Z",
      services: OPS_STATUS_SERVICE_IDS.map((id) => ({
        id,
        name: id,
        state: "healthy",
        controllable: id === "web",
        updatedAt: "2026-07-28T07:59:55.000Z",
      })),
    };

    expect(sanitizeOpsStatusPayload(payload, now).services).toHaveLength(
      OPS_STATUS_SERVICE_IDS.length,
    );
    expect(() => sanitizeOpsStatusPayload({
      ...payload,
      services: payload.services.slice(1),
    }, now)).toThrow("完整状态");
    expect(() => sanitizeOpsStatusPayload({
      ...payload,
      services: [...payload.services, payload.services[0]],
    }, now)).toThrow("完整状态");
  });

  it("marks old service readings stale and rejects timestamps from the future", () => {
    const now = Date.parse("2026-07-28T08:00:00.000Z");
    const services = OPS_STATUS_SERVICE_IDS.map((id) => ({
      id,
      name: id,
      state: "healthy",
      controllable: id === "web",
      updatedAt: id === "web"
        ? "2026-07-28T07:58:00.000Z"
        : "2026-07-28T07:59:55.000Z",
    }));
    const sanitized = sanitizeOpsStatusPayload({
      observedAt: "2026-07-28T07:59:55.000Z",
      services,
    }, now);

    expect(sanitized.services.find((service) => service.id === "web")).toMatchObject({
      state: "stale",
      controllable: false,
    });
    expect(() => sanitizeOpsStatusPayload({
      observedAt: "2026-07-28T08:01:00.000Z",
      services,
    }, now)).toThrow("时间");
  });
});
