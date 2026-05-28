import { db } from '../db.js';

export interface LoyaltyTierRow {
  code: string;
  name: string;
  threshold: number;
}

/**
 * Loyalty-tier lookups — raw SQL, because the eligibility predicate is
 * composed dynamically from the caller's feature context.
 */
export const loyaltyRepo = {
  async listEligibleTiers(activeFilter: string): Promise<LoyaltyTierRow[]> {
    // The allowed-tier set [bronze, silver, gold] matches the spec, but
    // the dynamically-interpolated `activeFilter` fragment is opaque to
    // the verifier — surfaced as a coverage gap rather than silently
    // dropped.
    // IL-DRIFT: QueryRule:loyalty-tiers.in-code / query.unparseable
    const result = await db.raw(
      `SELECT code, name, threshold
         FROM loyalty_tiers
        WHERE code IN ('bronze', 'silver', 'gold')
          AND ${activeFilter}`,
    );
    return result.rows as LoyaltyTierRow[];
  },
};
