import type { CreativeAgentRun, CreativeAgentSessionSummary } from "./contracts";

export type DebugCategory = "run" | "model" | "tool" | "media" | "http" | "canvas" | "usage";
export type DebugStatus = "running" | "success" | "error" | "waiting" | "unknown" | "reused" | "info";
export type DebugEvent = {
  id: string;
  sequence: number;
  runId: string;
  spanId: string;
  parentSpanId: string | null;
  category: DebugCategory;
  type: string;
  title: string;
  status: DebugStatus;
  createdAt: string;
  summary: Record<string, unknown>;
  hasDetail: boolean;
};
export type DebugDetail = DebugEvent & { detail: unknown };
export type DebugBatch = {
  events: DebugEvent[];
  nextSequence: number;
  nextPublicSequence: number;
  hasMore: boolean;
  run: CreativeAgentRun;
};
export type DebugIndex = { sessions: CreativeAgentSessionSummary[]; runs: CreativeAgentRun[]; hasMore: boolean };
export const DEBUG_DETAIL_DAYS = 7;
export const DEBUG_EVENT_DAYS = 30;
export const debugRunLabels: Record<string, string> = {
  queued: "等待执行", running: "正在执行", waiting_decision: "等待确认", waiting_action: "等待生成结果",
  paused: "已暂停", stopping: "正在停止", completed: "已完成", stopped: "已停止", failed: "执行失败",
};
