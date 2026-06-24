namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A <c>static readonly</c> field of a reference type (an array) that cannot be
/// expressed as a <c>const</c>, so the rule must not fire (CA1802). The rule is
/// limited to predefined primitives with a literal initializer.
/// </summary>
public class StaticReadonlyShouldBeConstSafe
{
    // SAFE: code-quality/deterministic/static-readonly-should-be-const
    private static readonly string[] DefaultScopes = { "read", "write" };

    internal string[] Scopes() => DefaultScopes;
}
