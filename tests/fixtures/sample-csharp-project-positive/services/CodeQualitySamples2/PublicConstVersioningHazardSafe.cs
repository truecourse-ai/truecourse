namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A public compile-time value exposed as <c>static readonly</c> is read at
/// runtime and updates for consumers on assembly swap, so the
/// public-const-versioning-hazard rule must not fire on it.
/// </summary>
public static class PublicConstVersioningHazardSafe
{
    /// <summary>The supported wire-protocol revision, read from the assembly.</summary>
    // SAFE: code-quality/deterministic/public-const-versioning-hazard
    public static readonly int ProtocolRevision = typeof(PublicConstVersioningHazardSafe).Assembly.GetName().Version!.Major;
}
