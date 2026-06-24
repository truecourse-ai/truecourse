namespace UserServiceApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal struct PriceBand
{
    public int Value;

    // VIOLATION: code-quality/deterministic/asymmetric-equality-operators
    public static bool operator <(PriceBand a, PriceBand b) => a.Value < b.Value;
    // VIOLATION: code-quality/deterministic/asymmetric-equality-operators
    public static bool operator >(PriceBand a, PriceBand b) => a.Value > b.Value;
}

internal class PrecedenceArithmetic
{
    internal decimal LineTotal(decimal unit, decimal quantity, decimal handling)
    {
        // VIOLATION: code-quality/deterministic/arithmetic-precedence-parentheses
        return unit + unit * quantity + handling;
    }

    internal bool AllowAccess(bool isOwner, bool isAdmin, bool isLocked)
    {
        // VIOLATION: code-quality/deterministic/conditional-precedence-parentheses
        return isOwner || isAdmin && isLocked;
    }
}
