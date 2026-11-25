import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server-auth";
import { prisma } from "@/lib/prisma";

// 读取登录态（cookie/headers），属于动态请求，显式声明避免构建期被当静态路由探测。
export const dynamic = "force-dynamic";

// 当前登录用户的"个人概览"统计：用于设置页的资料卡。
// 故意不依赖 admin storage 那套整盘扫描的重计算，只查 Generation 表里几个聚合，毫秒级返回。
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: apiMessage("mc1f658373079") }, { status: 401 });
    }

    // 口径（方案 A）：
    //   - type="import" 的素材上传记录全部排除（不算"产出"也不算"尝试"）
    //   - "累计产出" = 仅 status=success（真正出货的）
    //   - "总尝试数" = success + failed（不含 pending/processing 这种半成品）
    //   - "成功率 / 失败率" = 对照 总尝试数 计算（避免 pending 拉低分母）
    //   - latest 也只看 success，呼应"最近产出"语义
    const where = { authUserId: user.id, NOT: { type: "import" } };
    const successWhere = { ...where, status: "success" };
    const failedWhere = { ...where, status: "failed" };

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const [success, failed, latest, recent7] = await Promise.all([
      prisma.generation.count({ where: successWhere }),
      prisma.generation.count({ where: failedWhere }),
      prisma.generation.findFirst({
        where: successWhere,
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.generation.count({
        where: { ...successWhere, createdAt: { gte: sevenDaysAgo } },
      }),
    ]);

    const attempts = success + failed;
    const successRate = attempts > 0 ? Math.round((success / attempts) * 100) : 0;
    const failureRate = attempts > 0 ? Math.round((failed / attempts) * 100) : 0;

    return NextResponse.json({
      stats: {
        // 新口径
        totalGenerations: success, // = 累计成功产出，保留旧字段名向下兼容
        successCount: success,
        failedCount: failed,
        totalAttempts: attempts, // success + failed
        successRate,
        failureRate,
        recent7Count: recent7,
        lastCreatedAt: latest?.createdAt ?? null,
        userCreatedAt: user.createdAt ?? null,
      },
    });
  } catch (error) {
    console.error("获取个人统计失败:", error);
    return NextResponse.json({ error: apiMessage("me0eec9099b86") }, { status: 500 });
  }
}
