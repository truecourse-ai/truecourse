namespace Positive.Boundary.Architecture;

/// <summary>An audit marker scoped inside a file-scoped namespace.</summary>
// SAFE: architecture/deterministic/type-outside-namespace
public sealed class TypeOutsideNamespaceSafe
{
    /// <summary>The reason the marker was raised.</summary>
    public string Reason { get; set; } = string.Empty;
}
