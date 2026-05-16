
// Private constructor called internally via `new ClassName()` in static factory — singleton guard
declare global {
  // eslint-disable-next-line no-var
  var __app_license_manager__: LicenseManager | undefined;
}

export class LicenseManager {
  private cachedPlan: string | null = null;

  private constructor() {}

  public static async start(): Promise<void> {
    if (globalThis.__app_license_manager__) return;
    const instance = new LicenseManager();
    globalThis.__app_license_manager__ = instance;
    await instance.refresh();
  }

  private async refresh(): Promise<void> {
    this.cachedPlan = 'free';
  }

  public getPlan(): string | null {
    return this.cachedPlan;
  }
}


// productClaimId is validated against Object.values(PLAN_ID) before use (early return if invalid);
// plans is pre-populated with all PLAN_ID keys — access is always to an existing key.
enum SubscriptionPlanId { FREE = 'FREE', PRO = 'PRO', BUSINESS = 'BUSINESS', ENTERPRISE = 'ENTERPRISE' }

interface PlanEntitlement { maxContacts: number; maxStorage: number; apiEnabled: boolean }

const PLAN_ENTITLEMENTS: Record<SubscriptionPlanId, PlanEntitlement> = {
  [SubscriptionPlanId.FREE]: { maxContacts: 100, maxStorage: 100, apiEnabled: false },
  [SubscriptionPlanId.PRO]: { maxContacts: 5000, maxStorage: 10000, apiEnabled: true },
  [SubscriptionPlanId.BUSINESS]: { maxContacts: 50000, maxStorage: 100000, apiEnabled: true },
  [SubscriptionPlanId.ENTERPRISE]: { maxContacts: Infinity, maxStorage: Infinity, apiEnabled: true },
};

export function getEntitlementsForPlan(planId: string): PlanEntitlement | null {
  if (!Object.values(SubscriptionPlanId).includes(planId as SubscriptionPlanId)) {
    return null;
  }
  return PLAN_ENTITLEMENTS[planId as SubscriptionPlanId];
}



// unchecked-array-access: productClaimId used as array index without bounds check
interface LicenseTier { name: string; maxSeats: number; features: string[] }

function getTopFeature(tiers: LicenseTier[], idx: number): string {
  const features = tiers[idx].features;
  return features[0];
}

