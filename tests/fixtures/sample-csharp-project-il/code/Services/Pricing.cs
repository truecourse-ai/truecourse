// Pure pricing calculations. All money values in cents.
using SampleApi.Data.Entities;

namespace SampleApi.Services;

public static class Pricing
{
    // Discount percentage by spend tier. Spec table is bronze 5, silver 10,
    // gold 20. The gold rate drifted to 25, over-discounting gold orders.
    // IL-DRIFT: NamedConstant:DiscountTiers / constant.DiscountTiers.value-mismatch
    public static readonly Dictionary<string, int> DiscountTiers = new()
    {
        ["bronze"] = 5,
        ["silver"] = 10,
        ["gold"] = 25,
    };

    // Spec sets the pricing-service retry budget to 3. Code raised it to 5, so
    // transient pricing failures retry past the latency SLO.
    // IL-DRIFT: NamedConstant:MAX_RETRY / constant.MAX_RETRY.value-mismatch
    public const int MaxRetry = 5;

    // Spec also pins ApiVersion = "v2" as a named constant, but the code has no
    // such declaration — version negotiation is hard-coded inline instead.
    // IL-DRIFT: NamedConstant:ApiVersion / constant.ApiVersion.no-code-counterpart

    public static int TierDiscountPercent(string tier) => DiscountTiers[tier];

    public static int ComputeDiscountCents(int subtotalCents, Customer customer)
    {
        // Spec says the discount applies when subtotal_cents > 10000 (strict).
        // Using >= flips a $100.00 order from no-discount to 10%-off, dropping
        // revenue on the boundary.
        // IL-DRIFT: Formula:order.discount-cents / expression.threshold-operator.10000
        if (customer.LoyaltyTier == "gold" && subtotalCents >= 10000)
        {
            return (int)Math.Round(subtotalCents * 0.10);
        }

        return 0;
    }

    public static int ComputeTaxCents(int subtotalCents, int _discountCents)
    {
        // Spec says tax = 8% of (subtotal_cents - discount_cents). This taxes the
        // pre-discount subtotal, ignoring the discount entirely (the `_` prefix
        // marks the input as intentionally unused).
        // IL-DRIFT: Formula:order.tax-cents / inputs.discount_cents.unused
        return (int)Math.Round(subtotalCents * 0.08);
    }
}
