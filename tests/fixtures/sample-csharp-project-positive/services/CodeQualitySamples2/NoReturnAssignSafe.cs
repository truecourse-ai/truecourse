namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A <c>return</c> of an equality comparison. The no-return-assign rule flags an
/// assignment expression inside <c>return</c> (<c>return x = y;</c>); an
/// equality test that merely looks similar must not fire.
/// </summary>
public sealed class NoReturnAssignSafe
{
    /// <summary>True when the supplied counts are in balance.</summary>
    internal bool IsBalanced(int debits, int credits)
    {
        // SAFE: code-quality/deterministic/no-return-assign
        return debits == credits;
    }
}
