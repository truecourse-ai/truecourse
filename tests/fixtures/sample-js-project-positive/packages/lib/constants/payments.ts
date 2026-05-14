// Single constants file with context strings — each usage is standalone, not a duplication candidate
export const PLAN_STATUS_CONTEXT = 'Plan status';
export const PAYMENT_METHOD_CONTEXT = 'Payment method';
export const BILLING_INTERVAL_CONTEXT = 'Billing interval';

export type PlanStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';

export function formatPlanStatus(status: PlanStatus): string {
  const labels: Record<PlanStatus, string> = {
    active: 'Active',
    canceled: 'Canceled',
    past_due: 'Past due',
    trialing: 'Trial',
    incomplete: 'Incomplete',
  };
  return labels[status];
}
