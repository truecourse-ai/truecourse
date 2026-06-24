namespace Positive.Boundary.Bugs;

/// <summary>Normalizes header names with the round-trip-safe uppercase form.</summary>
public sealed class NormalizeToLowerNotUpperSafe
{
    /// <summary>Returns the canonical uppercase form of the header name.</summary>
    internal string Canonical(string header)
    {
        // SAFE: bugs/deterministic/normalize-to-lower-not-upper
        return header.ToUpperInvariant();
    }
}
