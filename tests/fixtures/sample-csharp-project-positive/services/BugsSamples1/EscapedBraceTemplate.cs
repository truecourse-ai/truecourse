namespace Positive.Boundary.Bugs;

/// <summary>
/// An interpolated string whose real <c>{expr}</c> hole is wrapped in escaped
/// braces — <c>$"{{{segment}}}"</c> renders a literal <c>{</c>, the interpolated
/// value, then a literal <c>}</c>. The <c>$</c> prefix is required, so the
/// fstring-missing-placeholders rule must not flag it.
/// </summary>
public sealed class EscapedBraceTemplate
{
    /// <summary>Wraps a path segment in literal braces around its value.</summary>
    public string Wrap(string segment)
    {
        // SAFE: bugs/deterministic/fstring-missing-placeholders
        return $"{{{segment}}}";
    }
}
