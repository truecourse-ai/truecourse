namespace Positive.Boundary.CodeQuality;

/// <summary>Passes an optional argument only when it differs from the declared default.</summary>
public sealed class ExplicitDefaultArgumentSafe
{
    /// <summary>Formats a title, optionally upper-casing it.</summary>
    internal string Banner(string title)
    {
        // SAFE: code-quality/deterministic/explicit-default-argument
        return Format(title, uppercase: false);
    }

    private static string Format(string title, bool uppercase = true)
    {
        return uppercase ? title.ToUpperInvariant() : title;
    }
}
