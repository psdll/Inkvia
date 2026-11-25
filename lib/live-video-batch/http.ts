import { NextResponse } from "next/server";
import { LiveVideoBatchError } from "@/lib/live-video-batch/service";
import { toLiveVideoBatchJson } from "@/lib/live-video-batch/serializers";
import { ToolMediaServiceError } from "@/lib/tool-media/service";
import { UploadLimitError } from "@/lib/upload-limits";

export function liveVideoBatchJson(data: unknown, status = 200) {
  return NextResponse.json(toLiveVideoBatchJson(data), { status });
}

export function liveVideoBatchError(error: unknown) {
  if (error instanceof LiveVideoBatchError) {
    return liveVideoBatchJson(
      { success: false, code: error.code, error: error.message },
      error.status,
    );
  }
  if (error instanceof ToolMediaServiceError || error instanceof UploadLimitError) {
    return liveVideoBatchJson(
      { success: false, code: "LIVE_VIDEO_MEDIA_UPLOAD_FAILED", error: error.message },
      error.status,
    );
  }
  console.error("[live-video-batch] request failed", error);
  return liveVideoBatchJson({
    success: false,
    code: "LIVE_VIDEO_INTERNAL_ERROR",
    error: "批量视频请求失败",
  }, 500);
}
