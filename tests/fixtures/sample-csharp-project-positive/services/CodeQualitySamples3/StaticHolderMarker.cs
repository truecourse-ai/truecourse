namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A marker/token type that carries a domain attribute and is consumed elsewhere
/// as a generic type argument. Its only member is the const the attribute
/// references, so it looks like a "static holder" — but a <c>static</c> class
/// cannot be used as a type argument, so making it static (or sealed) would change
/// its meaning or break callers.
/// </summary>
// SAFE: code-quality/deterministic/static-holder-type-not-sealed
[StorageBucket(Name)]
public class StaticHolderMarker
{
    /// <summary>The container name carried by the marker attribute.</summary>
    internal const string Name = "default";
}
