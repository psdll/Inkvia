"use client";

import * as React from "react";

export function PageTransition({
  before,
  children,
}: {
  before?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {before}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
