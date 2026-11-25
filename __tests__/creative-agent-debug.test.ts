import { describe, expect, it } from "vitest";
import { sanitizeDebugValue } from "@/lib/creative-agent/debug-sanitize";
import { recordCreativeDebug, withCreativeDebug, withDebugSpan } from "@/lib/creative-agent/debug-trace";
import { startDebugHttp } from "@/lib/creative-agent/debug-http";
import { withGenerationDebug } from "@/lib/creative-agent/debug-generation";

describe("Agent debug isolation", () => {
  it("redacts Ark Files signed URLs in upload responses and Seedance request traces", () => {
    const url = "https://ark-temp.example/clip.mp4?X-Tos-Signature=fixture-signature&X-Tos-Security-Token=fixture-token";
    const trace = JSON.stringify(sanitizeDebugValue({ download_url: url, video_url: { url } }));
    expect(trace).toContain("clip.mp4");
    expect(trace).not.toContain("fixture-signature");
    expect(trace).not.toContain("fixture-token");
  });

  it("redacts credentials before storage while preserving prompts, schemas and usage", () => {
    const value = sanitizeDebugValue({ headers: { Authorization: "Bearer fixture-secret", Cookie: "auth_token=abc", "X-Api-Key": "key-value" }, url: "https://user:pass@api.test/v1?token=abc&model=demo&X-Amz-Signature=xyz", body: JSON.stringify({ api_key: "hidden", messages: [{ role: "user", content: "分镜中需要 token 这个英文词" }], max_tokens: 8192 }), usage: { prompt_tokens: 34 }, result: "fixture-secret" }, ["fixture-secret"]);
    const encoded = JSON.stringify(value);
    for (const secret of ["fixture-secret", "key-value", "auth_token=abc", "user:pass", "hidden", "Signature=xyz", "token=abc"]) expect(encoded).not.toContain(secret);
    expect(encoded).toContain("分镜中需要 token"); expect(encoded).toContain("8192"); expect(encoded).toContain("prompt_tokens");
  });
  it("folds binary data with a stable fingerprint and visibly bounds oversized records", () => {
    expect(sanitizeDebugValue("data:image/png;base64,aGVsbG8=")).toMatchObject({ __traceBinary: true, bytes: 5, mimeType: "image/png", sha256: expect.any(String) });
    expect(sanitizeDebugValue("x".repeat(600_001))).toMatchObject({ __traceOmitted: true, size: 600_001 });
  });
  it("records in order, binds child spans, and never changes business outcome on a failed write", async () => {
    const records: any[] = [];
    const result = await withCreativeDebug({ runId: "r", canvasId: 2, actorUserId: 1, epoch: 1 }, async () => {
      recordCreativeDebug({ spanId: "model", category: "model", type: "sent", title: "请求" });
      withDebugSpan("model", () => recordCreativeDebug({ spanId: "http", category: "http", type: "sent", title: "HTTP" }));
      return "business-success";
    }, async record => { records.push(record); if (records.length === 1) throw new Error("storage offline"); });
    expect(result).toBe("business-success");
    expect(records.map(row => row.spanId)).toEqual(["model", "http"]);
    expect(records[1].parentSpanId).toBe("model");
    expect(records[0].runId).toBe("r");
  });
  it("retains event identity and explicitly marks oversized details", async () => {
    const records: any[] = [];
    await withCreativeDebug({ runId: "r", canvasId: 2, actorUserId: 1, epoch: 1 }, async () => {
      recordCreativeDebug({ spanId: "model", category: "model", type: "model.prepared", title: "大请求", detail: Array.from({length: 6}, () => "x".repeat(400_000)) });
    }, async record => { records.push(record); });
    expect(records[0]).toMatchObject({ spanId: "model", type: "model.prepared", detail: { __traceOmitted: true } });
  });
  it("observes actual HTTP data without consuming the response or retaining header credentials", async () => {
    expect(startDebugHttp({ url: "https://fixture.invalid", providerId: "fixture", mode: "direct" })).toBeNull();
    const records: any[] = [];
    const response = new Response(JSON.stringify({ answer: "ok", token: "fixture-private" }), { headers: { "content-type": "application/json" } });
    await withCreativeDebug({ runId: "r", canvasId: 2, actorUserId: 1, epoch: 1 }, async () => {
      const trace = startDebugHttp({ url: "https://fixture.invalid", providerId: "fixture", mode: "direct", method: "POST", headers: [["Authorization", "Bearer fixture-private"]], body: JSON.stringify({ prompt: "测试输入" }) });
      trace!.response(response.status, response.headers);
      await trace!.readJson(response);
      expect(await response.json()).toEqual({ answer: "ok", token: "fixture-private" });
    }, async record => { records.push(record); });
    expect(records.map(row => row.type)).toEqual(["http.dispatched", "http.response", "http.body"]);
    expect(JSON.stringify(records)).not.toContain("fixture-private");
    expect(records[0].detail.body).toEqual({ prompt: "测试输入" });
  });
  it("keeps media finalization results and links provider requests to the media span", async () => {
    const records: any[] = [];
    const result = await withCreativeDebug({ runId: "r", canvasId: 2, actorUserId: 1, epoch: 1 }, () => withGenerationDebug({ id: 7, source: "agent", requestKey: "key" }, async () => {
      startDebugHttp({ url: "https://fixture.invalid/status", providerId: "fixture", mode: "direct" });
      return "done";
    }), async record => { records.push(record); });
    expect(result).toBe("done");
    expect(records[0].parentSpanId).toBe("media:key");
    expect(records[1]).toMatchObject({ type: "media.poll", status: "success", eventKey: "finalize:7:done" });
  });
});
