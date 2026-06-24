namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A string literal whose backslash escapes a double-quote — a necessary escape
/// inside a string — so the useless-escape rule must not fire.
/// </summary>
public class UselessEscapeSafe
{
    /// <summary>Returns a quoted label for <paramref name="value"/>.</summary>
    internal string Quote(string value)
    {
        // SAFE: code-quality/deterministic/useless-escape
        return $"\"{value}\"";
    }
}
