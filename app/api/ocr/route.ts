import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import path from "path";
import { getKieLlmOcrModels } from "@/lib/config";
import { chatVision, getPublicLegacyLlmFailure } from "@/lib/llm";
import { Logger } from "@/lib/logger";
import { resolvePublicPath } from "@/lib/public-path";
import { getUserId } from "@/lib/server-auth";

// OCR 视觉接口。
//
// P3 重构:从直连 OpenRouter 切到 lib/llm.chatVision(走 kie.ai 的 gemini-3.1-pro)。
// 火山豆包文本模型不支持视觉,所以视觉路径不做兜底 —— kie.ai 挂了直接返回明确错误。

function mimeFromFilename(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

async function dataUrlFromPublicUploadPath(imagePath: string) {
  if (!imagePath.startsWith("/uploads/")) throw new Error("非法文件路径");
  const safe = imagePath.replaceAll("\\", "/");
  const full = resolvePublicPath(safe.replace(/^\/+/, ""));
  const buf = await fs.readFile(full);
  const name = path.basename(safe);
  const mime = mimeFromFilename(name);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const authUserId = await getUserId(req);
    if (!authUserId) {
      return NextResponse.json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });
    }
    const { imageUrl, userId } = (await req.json().catch(() => null)) as any;
    const img = String(imageUrl || "").trim();
    const uid = String(userId || "").trim() || undefined;
    if (!img) return NextResponse.json({ success: false, error: apiMessage("m20cea728be52") }, { status: 400 });

    const dataUrl = await dataUrlFromPublicUploadPath(img);

    const system = [
      "You are an OCR extractor for an image editor.",
      "Extract ALL visible text in the image and approximate bounding boxes.",
      "Return ONLY JSON with this schema:",
      "{",
      '  "blocks": [',
      "    {",
      '      "id": "string",',
      '      "text": "string",',
      '      "bbox": { "x": number, "y": number, "w": number, "h": number }',
      "    }",
      "  ]",
      "}",
      "bbox must be normalized to [0,1] relative to the image width/height.",
      "If you are unsure about bbox, still provide a best-effort bbox.",
      "Do not include any extra keys, markdown, or commentary.",
    ].join("\n");

    let result;
    try {
      result = await chatVision(
        [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract text blocks from this image." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        {
          models: getKieLlmOcrModels(),
          temperature: 0.2,
          responseFormat: "json_object",
        },
      );
    } catch (e: any) {
      const failure = getPublicLegacyLlmFailure(e, "OCR 模型调用失败，请稍后重试");
      await Logger.api("kie_ocr", `OCR 失败:${failure.category}`, "error", Date.now() - startTime, failure.logContext, uid);
      return NextResponse.json({ success: false, error: apiErrorMessage(failure.message) }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
    }

    const parsed = (result.value && typeof result.value === "object" ? result.value : null) as
      | { blocks?: unknown }
      | null;
    const blocksRaw = Array.isArray(parsed?.blocks) ? (parsed!.blocks as any[]) : [];

    const blocks = blocksRaw
      .map((b: any, idx: number) => {
        const text = String(b?.text || "").trim();
        const bbox = b?.bbox || {};
        const x = Number(bbox?.x);
        const y = Number(bbox?.y);
        const w = Number(bbox?.w);
        const h = Number(bbox?.h);
        if (!text) return null;
        if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
        const clamp = (v: number) => Math.min(1, Math.max(0, v));
        return {
          id: String(b?.id || `b_${idx}`),
          text,
          bbox: { x: clamp(x), y: clamp(y), w: clamp(w), h: clamp(h) },
        };
      })
      .filter(Boolean);

    await Logger.api(
      "kie_ocr",
      `OCR 成功(${result.model})`,
      "success",
      Date.now() - startTime,
      { model: result.model, blockCount: (blocks as any[]).length },
      uid,
    );
    return NextResponse.json({ success: true, blocks });
  } catch (e: any) {
    const failure = getPublicLegacyLlmFailure(e, "OCR 失败，请稍后重试");
    await Logger.api("kie_ocr", `OCR 异常:${failure.category}`, "error", Date.now() - startTime, failure.logContext);
    return NextResponse.json({ success: false, error: apiErrorMessage(failure.message) }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }
}
