using System.Collections.Generic;
using System.Linq;
using SampleApi.Data.Entities;

namespace SampleApi.Services;

// Customer read paths. Exercises field-exposure (EF Core projection),
// validation-rule (required-when guard), and persistence-strategy (metadata
// bag) for C#.
public class CustomerReadService
{
    private readonly AppDb _db = null!;

    // FIELD-EXPOSURE: the projection exposes LoyaltyTier + Status on the read
    // path (matches `customer.loyalty-tier-exposed`). It OMITS StoreCredit, so
    // `customer.store-credit-exposed` is never satisfied.
    // IL-DRIFT: FieldExposure:customer.store-credit-exposed / field-exposure.customer.store-credit-exposed.not-exposed
    public List<object> ProjectCustomers()
    {
        return _db.Customers.Select(c => new { c.LoyaltyTier, c.Status }).ToList<object>();
    }

    // VALIDATION-RULE (DIVERGENT): applies the status change with no
    // suspensionReason check, so the required-when rule is never enforced.
    // IL-DRIFT: ValidationRule:customer.suspension-reason-required-when-suspended / validation-rule.customer.suspension-reason-required-when-suspended.not-enforced
    public void ApplyAccountStatus(Customer customer, string status, string actor)
    {
        customer.Status = status;
    }

    // PERSISTENCE-STRATEGY (MATCHING): marketingOptIn is read off the Metadata
    // JSON bag, not a dedicated column — matches `persistence.marketingOptIn`.
    public bool ReadMarketingPref(Customer customer)
    {
        var opt = customer.Metadata["marketingOptIn"];
        return opt != null;
    }
}
