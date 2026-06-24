using System.Globalization;

namespace Positive.Boundary.Bugs;

/// <summary>Formats a status line whose placeholders match the supplied arguments.</summary>
internal sealed class FormatStringPlaceholderMismatchSafe
{
    /// <summary>Returns a formatted line describing a route and its hit count.</summary>
    internal string Describe(string route, int hits)
    {
        // SAFE: bugs/deterministic/format-string-placeholder-mismatch
        return string.Format(CultureInfo.InvariantCulture, "route {0} served {1} requests", route, hits);
    }
}
