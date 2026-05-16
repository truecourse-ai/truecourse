
// FP: async function with a simple guard clause — standard early-return
async function validateApiToken(inputToken: string): Promise<boolean> {
  if (!inputToken.startsWith('tok_')) {
    return false;
  }
  return true;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;


// Stripe metadata values are always strings; comparing to 'true' is the standard boolean-metadata pattern.
// The string 'true' is the serialized boolean representation, not a magic string.
declare const planMetadata: Record<string, string>;

function isPlanVisibleInCatalog(metadata: Record<string, string>): boolean {
  return metadata.visibleInApp === 'true';
}

function isPlanEligibleForTrial(metadata: Record<string, string>): boolean {
  return metadata.trialEligible === 'true' && metadata.deprecated !== 'true';
}

export function filterCatalogPlans(
  plans: Array<{ id: string; metadata: Record<string, string> }>,
): Array<{ id: string; metadata: Record<string, string> }> {
  return plans.filter(
    (plan) => isPlanVisibleInCatalog(plan.metadata) && isPlanEligibleForTrial(plan.metadata),
  );
}

