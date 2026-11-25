import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextResponse } from "next/server";
import { Logger } from "@/lib/logger";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, error: apiMessage("mca94802fc1b7") }, { status: 404 });
  }
  try {
    // 创建测试日志
    await Logger.userAction(
      "test_action",
      "这是一条测试日志",
      { test: true, timestamp: new Date().toISOString() },
      "test_user"
    );

    await Logger.generation(
      "test_task",
      "测试生成任务日志",
      "info",
      undefined,
      { model: "test", prompt: "测试提示词" },
      "test_user"
    );

    await Logger.generation(
      "test_success",
      "测试任务成功",
      "success",
      999,
      { duration: 1000, output: "/test/path" },
      "test_user"
    );

    await Logger.generation(
      "test_failed",
      "测试任务失败: 模拟错误",
      "error",
      998,
      { error: "这是一个测试错误", stack: "Error stack trace..." },
      "test_user"
    );

    return NextResponse.json({ 
      success: true, 
      message: "已创建 4 条测试日志，请刷新设置页面查看" 
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: apiErrorMessage(error.message)
    }, { status: 500 });
  }
}
