namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Hosts a NESTED type whose simple name (<c>CodeQuality</c>) matches a namespace declared
/// in this compilation (the enclosing <c>Positive.Boundary.CodeQuality</c>). A nested type
/// is reached through its enclosing type, so it can never create namespace ambiguity at a
/// use site, and type-name-matches-namespace must not fire on it.
/// </summary>
public sealed class TypeNameMatchesNamespaceNestedTypeSafe
{
    // SAFE: code-quality/deterministic/type-name-matches-namespace
    private sealed class CodeQuality { }

    /// <summary>Instantiates the nested type so it is not an unused private member.</summary>
    public object NestedMarker() => new CodeQuality();
}
