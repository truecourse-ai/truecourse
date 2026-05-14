
// --- react-useless-set-state FP: setState with function parameter (not current state) ---
declare function useState<T>(init: T): [T, (v: T) => void];

type BillingPeriod = 'monthly' | 'yearly';

interface BillingPeriodSelectorProps {
  plans: Array<{ monthly?: { id: string; price: number }; yearly?: { id: string; price: number } }>;
  onChange: (planId: string) => void;
}

function BillingPeriodSelector({ plans, onChange }: BillingPeriodSelectorProps) {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');

  const onBillingPeriodChange = (billingPeriod: BillingPeriod) => {
    const plan = plans.find((p) =>
      billingPeriod === 'monthly' ? p.yearly?.id : p.monthly?.id,
    );
    setBillingPeriod(billingPeriod);
    onChange(plan?.[billingPeriod]?.id ?? '');
  };

  return (
    <div>
      <button onClick={() => onBillingPeriodChange('monthly')}>Monthly</button>
      <button onClick={() => onBillingPeriodChange('yearly')}>Yearly</button>
    </div>
  );
}



// FP shape: featureFlags is typed Partial<TFeatureClaim> and accessed with flag.key as keyof TFeatureClaim
// — this is a typed object property lookup, not array indexing. Undefined is expected and handled by
// the boolean expression (!featureFlags[key]).
type TFeatureClaim = {
  advancedAnalytics: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  ssoEnabled: boolean;
};

function validateFeatureFlags(
  featureFlags: Partial<TFeatureClaim>,
  requiredFlags: Array<{ key: keyof TFeatureClaim; label: string }>,
): string[] {
  const missing: string[] = [];
  for (const flag of requiredFlags) {
    if (!featureFlags[flag.key]) {
      missing.push(flag.label);
    }
  }
  return missing;
}



// FP shape: productClaimId is validated against Object.values(CLAIM_ID_ENUM) before use (early return
// if invalid); plans is pre-populated with all CLAIM_ID_ENUM keys. Access is always to an existing key.
declare const enum SubscriptionPlanId { FREE = 'FREE', PRO = 'PRO', BUSINESS = 'BUSINESS', ENTERPRISE = 'ENTERPRISE' }

interface PlanEntitlement { maxUsers: number; maxStorage: number; apiEnabled: boolean }

const SUBSCRIPTION_ENTITLEMENTS: Record<SubscriptionPlanId, PlanEntitlement> = {
  [SubscriptionPlanId.FREE]: { maxUsers: 1, maxStorage: 100, apiEnabled: false },
  [SubscriptionPlanId.PRO]: { maxUsers: 5, maxStorage: 10000, apiEnabled: true },
  [SubscriptionPlanId.BUSINESS]: { maxUsers: 50, maxStorage: 100000, apiEnabled: true },
  [SubscriptionPlanId.ENTERPRISE]: { maxUsers: Infinity, maxStorage: Infinity, apiEnabled: true },
};

function getEntitlements(productClaimId: string): PlanEntitlement | null {
  if (!Object.values(SubscriptionPlanId).includes(productClaimId as SubscriptionPlanId)) {
    return null;
  }
  return SUBSCRIPTION_ENTITLEMENTS[productClaimId as SubscriptionPlanId];
}
