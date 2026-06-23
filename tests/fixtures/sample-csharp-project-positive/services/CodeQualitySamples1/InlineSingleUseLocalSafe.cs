namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A local initialised from a method call and read exactly once on the next statement,
/// but the read is nested inside a larger expression rather than a bare passthrough, so
/// the name aids readability and inline-single-use-local must not fire.
/// </summary>
public class InlineSingleUseLocalSafe
{
    /// <summary>Returns the tax for a subtotal, rounded up to whole currency units.</summary>
    public decimal RoundedTax(decimal subtotal)
    {
        // SAFE: code-quality/deterministic/inline-single-use-local
        var tax = ComputeTax(subtotal);
        return decimal.Ceiling(tax);
    }

    private const decimal TaxDivisor = 10m;

    private static decimal ComputeTax(decimal subtotal) => subtotal / TaxDivisor;
}
