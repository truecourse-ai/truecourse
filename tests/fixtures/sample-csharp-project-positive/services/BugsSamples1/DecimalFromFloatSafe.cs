namespace Positive.Boundary.Bugs;

/// <summary>Builds decimal values from exact decimal literals, not float literals.</summary>
public sealed class DecimalFromFloatSafe
{
    // SAFE: bugs/deterministic/decimal-from-float
    private const decimal TaxRate = 0.0825m;

    /// <summary>Applies the fixed tax rate to a subtotal.</summary>
    internal decimal ComputeSurcharge(decimal subtotal)
    {
        return subtotal * TaxRate;
    }
}
