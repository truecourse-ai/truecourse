namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A genuine widening cast of a variable to <c>long</c>. The rule flags only a
/// cast applied to a numeric LITERAL (where a suffix like <c>1L</c> would say
/// the type directly); casting a non-literal is a real conversion and must not
/// fire.
/// </summary>
public sealed class LiteralSuffixOverCastSafe
{
    /// <summary>Widens a counter to a 64-bit total.</summary>
    public long ToLong(int small)
    {
        // SAFE: code-quality/deterministic/literal-suffix-over-cast
        return (long)small;
    }
}
