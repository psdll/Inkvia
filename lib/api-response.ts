import { NextResponse } from "next/server";
import { ZodError, ZodSchema } from "zod";

// ── 统一 API 响应与错误处理 ──────────────────────────────────────────────
//
// 设计目标：
// - 路由抛出的任何异常都被捕获，返回结构化错误而非 500 裸崩。
// - 入参校验失败统一返回 400 + 可读信息。
// - 新路由用 withApiHandler 包裹；旧路由可渐进迁移。

/** 业务错误：路由中可直接 throw，会被 withApiHandler 转成对应状态码 */
export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/** 标准成功响应：{ success: true, data } */
export function apiSuccess<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

/** 标准错误响应：{ success: false, error } */
export function apiError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    { success: false, error: message, ...(details ? { details } : {}) },
    { status }
  );
}

function zodMessage(err: ZodError): string {
  const first = err.errors[0];
  if (!first) return "请求参数不合法";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/** 用 zod schema 校验 JSON 请求体，失败抛 ApiError(400) */
export async function parseJsonBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError("请求体不是合法的 JSON", 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(zodMessage(result.error), 400);
  }
  return result.data;
}

/** 用 zod schema 校验 FormData，失败抛 ApiError(400)。File 字段需在 schema 中用 z.any() */
export async function parseFormData<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError("请求体不是合法的表单数据", 400);
  }
  const obj: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    // 同名多值收集为数组
    if (key in obj) {
      const prev = obj[key];
      obj[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      obj[key] = value;
    }
  }
  const result = schema.safeParse(obj);
  if (!result.success) {
    throw new ApiError(zodMessage(result.error), 400);
  }
  return result.data;
}

type RouteHandler = (request: Request, context: any) => Promise<Response> | Response;

/**
 * 包裹路由处理函数，统一捕获异常：
 * - ApiError → 对应状态码 + 信息
 * - ZodError → 400
 * - 其它 → 500（信息脱敏，仅在服务端日志输出栈）
 */
export function withApiHandler(handler: RouteHandler): RouteHandler {
  return async (request: Request, context: any) => {
    try {
      return await handler(request, context);
    } catch (err) {
      if (err instanceof ApiError) {
        return apiError(err.message, err.status, err.details);
      }
      if (err instanceof ZodError) {
        return apiError(zodMessage(err), 400);
      }
      console.error("[api] 未处理异常:", err);
      return apiError("服务器内部错误，请稍后重试", 500);
    }
  };
}
