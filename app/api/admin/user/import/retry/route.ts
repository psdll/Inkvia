import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { retryUserImportJob } from "@/lib/admin/user-import-runner";
import { parseImportAccountOptions } from "@/lib/admin/user-migration-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);
  try {
    const body = await req.json() as { jobId?: string };
    const jobId = String(body.jobId || "").trim();
    if (!jobId) return bad("jobId 无效");
    await retryUserImportJob(jobId, parseImportAccountOptions(body));
    return NextResponse.json({ jobId });
  } catch (error) {
    return bad(error instanceof Error ? error.message : String(error));
  }
}
