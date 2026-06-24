namespace Positive.Boundary.Bugs;

/// <summary>Exposes the number of seconds in a day as a compile-time constant.</summary>
public sealed class ConstantBinaryExpressionSafe
{
    // SAFE: bugs/deterministic/constant-binary-expression
    private const int SecondsPerDay = 24 * 60 * 60;

    /// <summary>Returns how many seconds the given whole number of days spans.</summary>
    internal int SecondsForDays(int days) => days * SecondsPerDay;
}
