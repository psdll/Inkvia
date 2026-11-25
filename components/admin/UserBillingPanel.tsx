"use client";
import { UiText } from "@/i18n/ui";

import MonthlyBillingPanel from "./MonthlyBillingPanel";
import type { BillingDateRange } from "./UserBillingTrend";

export default function UserBillingPanel({
  user,
  initialRange,
}: {
  initialRange?: BillingDateRange;
  user: {
    userId: string;
    authUserId?: number | null;
    username?: string | null;
  } | null;
}) {
  return user ? (
    <MonthlyBillingPanel user={user} initialRange={initialRange} />
  ) : (
    <div className="p-8 text-center"><UiText id="admin.mdb7b7314bb25" /></div>
  );
}
