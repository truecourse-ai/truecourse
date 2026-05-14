
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


// FP 417d07d5db1b: mode = 'edit' as default parameter for RenderMode discriminant
// 'edit' / 'preview' / 'readonly' are discriminant literals defined by the type — not magic strings.
type RenderMode_417d = 'preview' | 'edit' | 'readonly';
export function renderFieldValue_417d(
  value: string,
  fieldType: string,
  mode: RenderMode_417d = 'edit',
): string {
  if (mode === 'readonly') return value;
  if (mode === 'preview') return value.length > 0 ? value : `[${fieldType}]`;
  return value;
}



// FP a65cc23423fa: 'Retry-After' appears in rate-limit header code
// 'Retry-After' is an RFC 6585 standard HTTP header name — a protocol constant, not a magic string.
// The rule fired because the literal appears multiple times, but it's an industry-standard name.
export function buildRateLimitHeaders_a65cc(
  resetAt: Date,
): Record<string, string> {
  const retryAfterSecs = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  return {
    'Retry-After': String(retryAfterSecs),
    'X-RateLimit-Remaining': '0',
    'X-RateLimit-Reset': resetAt.toISOString(),
  };
}



// Suspense used for lazy code-splitting, not async data — no wrapper needed
declare function useQuery<T>(opts: { queryKey: unknown[] }): { data: T | undefined };

export function LazyBillingInfo({ orgId }: { orgId: string }) {
  const { data } = useQuery<{ plan: string }>({ queryKey: ['billing', orgId] });
  return <div>{data?.plan ?? 'loading'}</div>;
}



// FP 98bd37827550: 'signer@documenso.com' / 'SIGNING_TOKEN' in webhook sample data generator
// These are demo/placeholder strings in a test-data factory — not magic strings needing constants.
export function generateWebhookSamplePayload_98bd() {
  return {
    event: 'envelope.completed',
    recipients: [
      {
        id: 52,
        email: 'signer@documenso.com',
        name: 'John Doe',
        token: 'SIGNING_TOKEN',
        role: 'SIGNER',
      },
    ],
  };
}

