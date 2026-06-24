namespace Positive.Boundary.CodeQuality;

/// <summary>Exposes a total and a differently named accessor method.</summary>
public sealed class PropertyNameMatchesGetMethodSafe
{
    /// <summary>The running total accumulated so far.</summary>
    public int Total { get; private set; }

    /// <summary>Adds the amount to the total and returns a formatted summary line.</summary>
    // SAFE: code-quality/deterministic/property-name-matches-get-method
    public string GetSummary(int amount)
    {
        Total += amount;
        return $"total {Total}";
    }
}
