import prisma from "./prisma";
import { pruneLogsIfNeeded } from "@/lib/log-retention";

export type LogCategory = "user_action" | "generation" | "api" | "system";
export type LogLevel = "info" | "warning" | "error" | "success";

export interface LogOptions {
  userId?: string;
  category: LogCategory;
  action: string;
  level?: LogLevel;
  message: string;
  metadata?: Record<string, any>;
  ip?: string;
  userAgent?: string;
  duration?: number;
  generationId?: number;
}

/**
 * 统一日志记录器
 *
 * 设计：日志写入为「非阻塞」—— log() 立即返回，DB 写入在后台进行。
 * 这样生成类接口不会因为写几条日志而拖慢响应。日志写入/清理失败均不影响主流程。
 */
export class Logger {
  /**
   * 记录日志到数据库（非阻塞：不 await DB 写入）
   */
  static log(options: LogOptions): void {
    // 后台执行，不阻塞调用方
    void (async () => {
      try {
        // prune 自身已有 6 小时节流；放在后台，不阻塞日志写入
        void pruneLogsIfNeeded().catch(() => {});
        await prisma.log.create({
          data: {
            userId: options.userId || "system",
            category: options.category,
            action: options.action,
            level: options.level || "info",
            message: options.message,
            metadata: options.metadata ? JSON.stringify(options.metadata) : null,
            ip: options.ip || null,
            userAgent: options.userAgent || null,
            duration: options.duration || null,
            generationId: options.generationId || null,
          },
        });
      } catch (error) {
        // 日志记录失败不应该影响主流程，仅输出到控制台
        console.error("[Logger] Failed to write log:", error);
      }
    })();
  }

  /**
   * 用户行为日志
   */
  static async userAction(
    action: string,
    message: string,
    metadata?: Record<string, any>,
    userId?: string
  ): Promise<void> {
    this.log({
      userId,
      category: "user_action",
      action,
      level: "info",
      message,
      metadata,
    });
  }

  /**
   * 生成任务日志
   */
  static async generation(
    action: string,
    message: string,
    level: LogLevel,
    generationId?: number,
    metadata?: Record<string, any>,
    userId?: string
  ): Promise<void> {
    this.log({
      userId,
      category: "generation",
      action,
      level,
      message,
      metadata,
      generationId,
    });
  }

  /**
   * API 调用日志
   */
  static async api(
    action: string,
    message: string,
    level: LogLevel,
    duration?: number,
    metadata?: Record<string, any>,
    userId?: string
  ): Promise<void> {
    this.log({
      userId,
      category: "api",
      action,
      level,
      message,
      metadata,
      duration,
    });
  }

  /**
   * 系统错误日志
   */
  static async error(
    action: string,
    message: string,
    error: any,
    metadata?: Record<string, any>
  ): Promise<void> {
    const errorDetails = {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      ...metadata,
    };

    this.log({
      category: "system",
      action,
      level: "error",
      message,
      metadata: errorDetails,
    });
  }

  /**
   * 从 Request 中提取 IP 和 UserAgent
   */
  static extractRequestInfo(request: Request): { ip?: string; userAgent?: string } {
    return {
      ip: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    };
  }
}
