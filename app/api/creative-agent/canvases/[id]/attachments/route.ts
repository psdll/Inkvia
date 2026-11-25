import { creativeAgentApi, readCreativeAgentJson } from "@/lib/creative-agent/api";
import { z } from "zod";
import { requireCreativeAgentUser } from "@/lib/creative-agent/access";
import {
  creativeAgentCanvasIdSchema,
  creativeAgentSessionIdSchema,
} from "@/lib/creative-agent/schemas";
import { importPersonalMaterialAttachment, uploadCreativeAgentAttachment } from "@/lib/creative-agent/attachments";
import { CreativeAgentError } from "@/lib/creative-agent/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  return creativeAgentApi(async () => {
    const actorUserId = await requireCreativeAgentUser(request, true);
    const canvasId = creativeAgentCanvasIdSchema.parse(params.id);
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const input = z.object({ sessionId: creativeAgentSessionIdSchema, materialId: z.string().uuid() }).strict().parse(await readCreativeAgentJson(request));
      return { attachment: await importPersonalMaterialAttachment(actorUserId, canvasId, input.sessionId, input.materialId) };
    }
    const length = Number(request.headers.get("content-length"));
    if (length > 101_000_000)
      throw new CreativeAgentError("ATTACHMENT_TOO_LARGE", "上传大小超限", 413);
    if (!request.body)
      throw new CreativeAgentError("ATTACHMENT_REQUIRED", "请选择附件", 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > 101_000_000)
          throw new CreativeAgentError(
            "ATTACHMENT_TOO_LARGE",
            "上传大小超限",
            413,
          );
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers.get("content-type") || "" },
    }).formData();
    const sessionId = creativeAgentSessionIdSchema.parse(form.get("sessionId"));
    const file = form.get("file");
    if (!file || typeof file === "string")
      throw new CreativeAgentError("ATTACHMENT_REQUIRED", "请选择附件", 400);
    return {
      attachment: await uploadCreativeAgentAttachment(
        actorUserId,
        canvasId,
        sessionId,
        file,
      ),
    };
  });
}
