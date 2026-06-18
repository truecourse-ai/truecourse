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
    // IL-DRIFT: QueryRule:loyalty-tiers.in-code / query.unparseable @ loyaltyRepo.listEligibleTiers#0
    const result = await db.raw(
      `SELECT code, name, threshold
         FROM loyalty_tiers
        WHERE code IN ('bronze', 'silver', 'gold')
          AND ${activeFilter}`,
    );
    return result.rows as LoyaltyTierRow[];
  },

  // Every direct lookup restricts to active tiers — retired tiers stay in the
  // table for historical orders but must never be offered to customers. This
  // is a real, consistently-applied data policy that no spec records.
  async listActiveTiers(): Promise<LoyaltyTierRow[]> {
    const result = await db.raw(
      `SELECT code, name, threshold
         FROM loyalty_tiers
        WHERE is_active = TRUE
        ORDER BY threshold ASC`,
    );
    return result.rows as LoyaltyTierRow[];
  },

  async findActiveTier(code: string): Promise<LoyaltyTierRow | null> {
    const result = await db.raw(
      `SELECT code, name, threshold
         FROM loyalty_tiers
        WHERE is_active = TRUE
          AND code = $1`,
      [code],
    );
    return (result.rows[0] as LoyaltyTierRow | undefined) ?? null;
  },
};
