namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Reports whether a value is within range using a single boolean expression
/// rather than separate <c>if (…) return true;</c> / <c>return false;</c>
/// branches, so the collapse-to-one-return rule has nothing to flag.
/// </summary>
public sealed class PreferSingleBooleanReturnSafe
{
    internal bool InRange(int value, int min, int max)
    {
        // SAFE: code-quality/deterministic/prefer-single-boolean-return
        return value >= min && value <= max;
    }
}
