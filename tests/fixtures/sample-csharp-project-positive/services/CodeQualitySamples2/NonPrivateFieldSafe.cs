using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Exposed fields in their legitimate form: an <c>internal const</c> and a
/// public <c>static readonly</c> immutable shared collection. Both are the
/// documented exception, so the non-private-field rule must not fire.
/// </summary>
public class NonPrivateFieldSafe
{
    // SAFE: code-quality/deterministic/non-private-field
    internal const int MaxRetries = 3;

    public static readonly IReadOnlyList<string> DefaultRegions = new[] { "us-east" };

    /// <summary>Describes the retry policy across the default regions.</summary>
    internal string Describe()
    {
        return $"{DefaultRegions.Count}:{MaxRetries}";
    }
}
