import { NextResponse } from "next/server";
import { ImageBatchServiceError } from "@/lib/image-batch/service";
import { toImageBatchJson } from "@/lib/image-batch/serializers";

export function imageBatchJson(data: unknown, status = 200) {
  return NextResponse.json(toImageBatchJson(data), { status });
}

export function imageBatchError(error: unknown) {
  if (error instanceof ImageBatchServiceError) {
    return imageBatchJson({ success: false, code: error.code, error: error.message }, error.status);
  }
  console.error("[image-batch] request failed", error);
  return imageBatchJson({ success: false, code: "BATCH_INTERNAL_ERROR", error: "批量请求失败" }, 500);
}
