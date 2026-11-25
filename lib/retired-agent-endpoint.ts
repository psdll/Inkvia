import { NextResponse } from "next/server";

export function retiredAgentWorkspace(_request: Request, _context?: unknown) {
  return NextResponse.json(
    {
      success: false,
      code: "AGENT_RUNTIME_RETIRED",
      error: "旧 Agent 工作区已退役，请打开画布使用创作 Agent。",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store, no-cache, no-transform" },
    },
  );
}
