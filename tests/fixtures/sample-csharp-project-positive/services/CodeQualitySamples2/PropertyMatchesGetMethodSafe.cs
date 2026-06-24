namespace Positive.Boundary.CodeQuality;

/// <summary>Exposes a count alongside a differently named accessor method.</summary>
public sealed class PropertyMatchesGetMethodSafe
{
    /// <summary>The number of items currently held.</summary>
    public int Count { get; private set; }

    /// <summary>Records one more item and returns a formatted label for it.</summary>
    // SAFE: code-quality/deterministic/property-matches-get-method
    public string GetLabel(string name)
    {
        Count += 1;
        return $"{name} #{Count}";
    }
}
