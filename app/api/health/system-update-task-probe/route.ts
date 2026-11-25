import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  assertDurableWorkAdmission,
  MaintenanceSubmissionError,
} from "@/lib/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const PROOF_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const PROOF_HEADER = "x-inkvia-system-update-proof";
const ROLLBACK = new Error("SYSTEM_UPDATE_PROBE_ROLLBACK");

function json(body: { ok: boolean; code?: string }, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function notFound() {
  return json({ ok: false, code: "NOT_FOUND" }, 404);
}

function parseNonce(raw: string): string | null {
  if (raw.length < 1 || raw.length > 128) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object"
      || value === null
      || Array.isArray(value)
      || Object.keys(value).length !== 1
      || !("nonce" in value)
      || typeof value.nonce !== "string"
      || !NONCE_PATTERN.test(value.nonce)
    ) {
      return null;
    }
    return value.nonce;
  } catch {
    return null;
  }
}

function validProof(secret: string, nonce: string, supplied: string): boolean {
  if (!SECRET_PATTERN.test(secret) || !PROOF_PATTERN.test(supplied)) return false;
  const expected = createHmac("sha256", secret)
    .update(`system-update-task-probe:${nonce}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(supplied, "hex"));
}

export async function POST(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return notFound();
  }
  const nonce = parseNonce(await request.text());
  if (nonce === null) return notFound();

  const secret = process.env.SYSTEM_UPDATE_PROXY_PROOF || "";
  const proof = request.headers.get(PROOF_HEADER) || "";
  if (!validProof(secret, nonce, proof)) {
    return json({ ok: false, code: "FORBIDDEN" }, 403);
  }

  try {
    await assertDurableWorkAdmission();
    const jobId = `update-probe-${nonce}`;
    await prisma.$transaction(async (tx) => {
      const created = await tx.adminJob.create({
        data: {
          jobId,
          type: "system_update_probe",
          status: "probe",
          progress: 0,
          payload: { nonce },
        },
      });
      if (created.jobId !== jobId) throw new Error("SYSTEM_UPDATE_PROBE_INVALID");
      throw ROLLBACK;
    }).catch((error: unknown) => {
      if (error !== ROLLBACK) throw error;
    });
    const residue = await prisma.adminJob.findUnique({
      where: { jobId },
      select: { jobId: true },
    });
    if (residue !== null) throw new Error("SYSTEM_UPDATE_PROBE_RESIDUE");
    return json({ ok: true }, 200);
  } catch (error) {
    if (error instanceof MaintenanceSubmissionError) {
      return json({ ok: false, code: error.code }, 503);
    }
    return json({ ok: false, code: "TASK_PROBE_FAILED" }, 503);
  }
}

export const GET = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
