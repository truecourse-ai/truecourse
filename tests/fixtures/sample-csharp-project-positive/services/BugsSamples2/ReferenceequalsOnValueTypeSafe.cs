namespace Positive.Boundary.Bugs;

/// <summary>Detects whether two session tokens are the same object instance.</summary>
public sealed class ReferenceequalsOnValueTypeSafe
{
    /// <summary>Returns true when both references point at the same token object.</summary>
    internal bool IsSameInstance(string? left, string? right)
    {
        // SAFE: bugs/deterministic/referenceequals-on-value-type
        return ReferenceEquals(left, right);
    }
}
