import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CreativeAgentError } from "./errors";
import { HttpError } from "./store-types";
import { MaintenanceSubmissionError } from "@/lib/maintenance";

export async function creativeAgentApi(action: () => Promise<unknown>) {
  try {
    return NextResponse.json(await action(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ success: false, code: "INVALID_INPUT", error: "请求内容不完整或格式无效" }, { status: 400 });
    if (error instanceof CreativeAgentError || error instanceof HttpError) return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: error.status });
    if (error instanceof MaintenanceSubmissionError) return NextResponse.json({ success: false, code: error.code, error: "系统正在更新，请稍后继续" }, { status: 503 });
    // Database/provider diagnostics can include private connection information.
    console.error("creative agent request failed", { type: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ success: false, code: "AGENT_REQUEST_FAILED", error: "Agent 请求未完成，请稍后查看任务状态" }, { status: 500 });
  }
}

export async function readCreativeAgentJson(request: Request) {
  const body = await request.text();
  if (Buffer.byteLength(body) > 128 * 1024) throw new CreativeAgentError("REQUEST_TOO_LARGE", "请求内容过大", 413);
  try { return JSON.parse(body); } catch { throw new CreativeAgentError("INVALID_JSON", "请求格式无效", 400); }
}
