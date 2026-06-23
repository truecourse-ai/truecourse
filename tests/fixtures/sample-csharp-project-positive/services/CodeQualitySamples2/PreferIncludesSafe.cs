namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Tests whether a string contains a separator. It already uses
/// <c>Contains</c>, the form the prefer-Contains rule steers toward, instead of
/// the <c>IndexOf(x) &gt;= 0</c> existence-test shape the rule flags.
/// </summary>
public sealed class PreferIncludesSafe
{
    internal bool HasSeparator(string text)
    {
        // SAFE: code-quality/deterministic/prefer-includes
        return text.Contains(',');
    }
}
