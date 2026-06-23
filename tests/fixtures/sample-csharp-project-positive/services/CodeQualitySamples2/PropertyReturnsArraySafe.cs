namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A byte-array property models a binary payload, the idiomatic shape the rule
/// explicitly excludes. The property-returns-array rule must not fire.
/// </summary>
public class PropertyReturnsArraySafe
{
    /// <summary>Raw binary content of the document.</summary>
    // SAFE: code-quality/deterministic/property-returns-array
    public byte[] Payload { get; init; } = System.Array.Empty<byte>();
}
