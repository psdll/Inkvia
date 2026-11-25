export function isFailedBillingStatus(status: string | null | undefined) {
  return ['failed', 'cancelled', 'canceled'].includes(String(status || '').toLowerCase());
}

// Product rule: failed tasks are excluded, even when a supplier reported usage.
// Keep usage and quoted prices for audit; they must never become a payable amount.
export function failedCostData(pricingSnapshot: any) {
  return {
    billable: false,
    costStatus: 'failed',
    unitCount: 0,
    unitPrice: 0,
    amount: 0,
    pricingSnapshot: {
      ...(pricingSnapshot || {}),
      excludedReason: 'task_failed',
      charges: [],
      conversion: { ...(pricingSnapshot?.conversion || {}), originalAmount: '0', amountCny: '0' },
    },
  };
}
