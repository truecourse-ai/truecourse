using System.Diagnostics.Contracts;

namespace Positive.Boundary.Bugs;

/// <summary>
/// Combines two lengths. The method is marked [Pure] and returns the computed value, so
/// it has an observable result and the rule (which flags [Pure] void methods) must not
/// fire.
/// </summary>
public sealed class PureMethodReturnsVoidSafe
{
    [Pure]
    // SAFE: bugs/deterministic/pure-method-returns-void
    internal int Combine(string left, string right) => left.Length + right.Length;
}
