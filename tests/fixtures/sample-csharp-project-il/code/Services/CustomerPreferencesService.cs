using SampleApi.Data.Entities;

namespace SampleApi.Services;

// Customer preferences read path. Exercises the runtime null/absent → default
// coalescing (fallback) kind for C#: one matching site, one divergent site.
public class CustomerPreferencesService
{
    private const string DefaultLoyaltyTier = "standard";

    // MATCHING: the loyalty-tier fallback IS applied — `?? DefaultLoyaltyTier`
    // coalesces a missing tier, exactly as `customer.loyalty-tier-default` states.
    public string ResolveLoyaltyTier(Customer customer)
    {
        var loyaltyTier = customer.LoyaltyTier ?? DefaultLoyaltyTier;
        return loyaltyTier;
    }

    // DIVERGENT: `customer.status-default` says a missing status falls back to a
    // default, but Status is read straight through — the fallback is never applied.
    public string ResolveStatus(Customer customer)
    {
        // IL-DRIFT: Fallback:customer.status-default / fallback.customer.status-default.not-applied
        var status = customer.Status;
        return status;
    }
}
