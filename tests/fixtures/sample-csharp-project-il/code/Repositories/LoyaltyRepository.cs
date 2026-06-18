using System.Data;
using Dapper;
using SampleApi.Data.Entities;

namespace SampleApi.Repositories;

// Loyalty-tier lookups — raw SQL (Dapper), because the eligibility predicate is
// composed dynamically from the caller's feature context.
public class LoyaltyRepository
{
    private readonly IDbConnection _db;

    public LoyaltyRepository(IDbConnection db) => _db = db;

    public IEnumerable<LoyaltyTier> ListEligibleTiers(string activeFilter)
    {
        // The allowed-tier set [bronze, silver, gold] matches the spec, but the
        // interpolated `activeFilter` fragment is opaque to the verifier —
        // surfaced as a coverage gap rather than silently dropped.
        // IL-DRIFT: QueryRule:loyalty-tiers.allowed-tiers / query.unparseable
        return _db.Query<LoyaltyTier>(
            $"SELECT code, name, threshold FROM loyalty_tiers "
            + $"WHERE code IN ('bronze', 'silver', 'gold') AND {activeFilter}");
    }

    public IEnumerable<LoyaltyTier> ListActiveTiers()
    {
        // Every direct lookup restricts to active tiers — retired tiers stay in
        // the table for historical orders but must never be offered to customers.
        // A real, consistently-applied data policy that no spec records.
        return _db.Query<LoyaltyTier>(
            "SELECT code, name, threshold FROM loyalty_tiers "
            + "WHERE is_active = TRUE ORDER BY threshold ASC");
    }

    public IEnumerable<LoyaltyTier> FindActiveTier(string code)
    {
        return _db.Query<LoyaltyTier>(
            "SELECT code, name, threshold FROM loyalty_tiers "
            + "WHERE is_active = TRUE AND code = @code",
            new { code });
    }
}
