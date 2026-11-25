import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const COOKIE_KEY = "ai_studio_device_id";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, error: apiMessage("mca94802fc1b7") }, { status: 404 });
  }
  try {
    // 从 Cookie 获取当前用户ID
    const userId = request.cookies.get(COOKIE_KEY)?.value || "unknown";

    // 插入多条不同类型的测试日志
    await prisma.log.createMany({
      data: [
        {
          userId,
          category: "user_action",
          action: "page_view",
          level: "info",
          message: "用户访问了人脸替换页面",
          metadata: JSON.stringify({ page: "/face" }),
        },
        {
          userId,
          category: "user_action",
          action: "file_upload",
          level: "info",
          message: "用户上传了参考人脸图片",
          metadata: JSON.stringify({ filename: "face.jpg", size: 1024000 }),
        },
        {
          userId,
          category: "generation",
          action: "task_create",
          level: "info",
          message: `用户 ${userId.substring(0, 8)}... 创建人脸替换任务`,
          metadata: JSON.stringify({ model: "Comfy-Local", prompt: "测试提示词" }),
          generationId: null,
        },
        {
          userId,
          category: "api",
          action: "comfy_request",
          level: "success",
          message: "ComfyUI 工作流执行完成",
          metadata: JSON.stringify({ promptId: "test-prompt-123" }),
          duration: 12345,
        },
        {
          userId,
          category: "generation",
          action: "task_success",
          level: "success",
          message: "人脸替换任务执行成功",
          metadata: JSON.stringify({ duration: 15000, outputPath: "/uploads/face_results/test.png" }),
          generationId: null,
        },
        {
          userId,
          category: "generation",
          action: "task_failed",
          level: "error",
          message: "视频生成任务失败: KIE API 返回 429 Too Many Requests",
          metadata: JSON.stringify({ error: "429 Too Many Requests", model: "video-test-model" }),
        },
        {
          userId,
          category: "system",
          action: "api_error",
          level: "warning",
          message: "外部 API 响应缓慢，耗时超过 10 秒",
          metadata: JSON.stringify({ api: "KIE", responseTime: 12340 }),
          duration: 12340,
        },
      ],
    });

    const count = await prisma.log.count({ where: { userId } });

    return NextResponse.json({
      success: true,
      message: `已为用户 ${userId.substring(0, 8)}... 创建 7 条测试日志，共 ${count} 条`,
      userId,
      totalCount: count,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: apiErrorMessage(error.message) },
      { status: 500 }
    );
  }
}
