namespace Positive.Boundary.CodeQuality;

/// <summary>A money-bearing entity used as the projection source.</summary>
public sealed class Charge
{
    /// <summary>The stored monetary amount.</summary>
    public decimal Amount { get; init; }
}

/// <summary>
/// An anonymous type whose member is deliberately renamed
/// (<c>Total = charge.Amount</c>) carries information the compiler could not
/// infer, so the redundant-anonymous-property-name rule must not fire.
/// </summary>
public sealed class RedundantAnonymousPropertyNameSafe
{
    /// <summary>Projects the charge under a renamed member.</summary>
    public object Project(Charge charge)
    {
        // SAFE: code-quality/deterministic/redundant-anonymous-property-name
        return new { Total = charge.Amount };
    }
}
