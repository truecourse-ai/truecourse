
// [unknown-catch-variable] catch(err) — instanceof Error guard before .message access
declare function checkSubscriptionLimits(orgId: string): Promise<{ withinLimits: boolean; reason?: string }>;
declare function logLimitCheckFailure(reason: string): void;

async function assertWithinLimits(orgId: string): Promise<boolean> {
  try {
    const { withinLimits } = await checkSubscriptionLimits(orgId);
    return withinLimits;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown limit check failure';
    logLimitCheckFailure(reason);
    return false;
  }
}
