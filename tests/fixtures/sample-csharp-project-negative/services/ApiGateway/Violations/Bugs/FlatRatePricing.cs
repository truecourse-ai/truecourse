using System.ComponentModel.Composition;

namespace ApiGateway.Violations.Bugs;

/// <summary>
/// A MEF-exported pricing strategy. With no [PartCreationPolicy] its lifetime follows the
/// container default, so one composition may share a single instance while another mints a
/// fresh one — surprising for a part that caches rates.
/// </summary>
// VIOLATION: bugs/deterministic/mef-export-missing-creation-policy
[Export(typeof(IPricingStrategy))]
internal sealed class FlatRatePricing : IPricingStrategy
{
    private const decimal BaseRate = 9.99m;

    /// <inheritdoc />
    public decimal RateFor(string sku) => string.IsNullOrEmpty(sku) ? 0m : BaseRate;
}

internal interface IPricingStrategy
{
    decimal RateFor(string sku);
}
