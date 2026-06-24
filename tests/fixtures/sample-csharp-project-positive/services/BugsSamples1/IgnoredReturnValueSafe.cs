namespace Positive.Boundary.Bugs;

/// <summary>String normalization that uses every pure-method result — nothing discarded.</summary>
public sealed class IgnoredReturnValueSafe
{
    /// <summary>Returns the trimmed, uppercased topic.</summary>
    internal string Normalize(string topic)
    {
        // SAFE: bugs/deterministic/ignored-return-value
        var trimmed = topic.Trim();
        return trimmed.ToUpperInvariant();
    }
}
