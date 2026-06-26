namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A marker type carrying a domain attribute whose only member is the const name
/// the attribute references. The rule sees "nothing but static members", but a
/// metadata-bearing marker (often consumed where a <c>static class</c> is illegal,
/// e.g. as a generic type argument) must not be told to become <c>static</c>.
/// </summary>
// SAFE: code-quality/deterministic/no-extraneous-class
[StorageBucket(Name)]
public sealed class NoExtraneousClassMarker
{
    /// <summary>The container name carried by the marker attribute.</summary>
    internal const string Name = "default";
}
