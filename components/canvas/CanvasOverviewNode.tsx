"use client";

import * as React from "react";
import type { NodeProps } from "@xyflow/react";
import type { CanvasFlowNode } from "@/components/canvas/CanvasNodeCard";

export default function CanvasOverviewNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  return (
    <div
      className={`h-full w-full rounded-xl border ${selected ? "border-[var(--primary-bg)] bg-[color-mix(in_srgb,var(--primary-bg)_28%,var(--panel-bg))]" : "border-[var(--border-2)] bg-[var(--panel-bg)]"}`}
      aria-label={`${data.kind} node overview`}
    >
      <span className="sr-only">{data.kind}</span>
    </div>
  );
}
