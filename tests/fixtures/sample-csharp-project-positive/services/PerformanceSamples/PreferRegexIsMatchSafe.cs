using System.Text.RegularExpressions;

namespace Positive.Boundary.Performance;

/// <summary>Validates SKU codes against a fixed pattern.</summary>
public sealed class PreferRegexIsMatchSafe
{
    /// <summary>Tests the pattern with IsMatch, which returns the boolean without a Match allocation.</summary>
    public bool IsSku(string candidate)
    {
        // SAFE: performance/deterministic/prefer-regex-ismatch
        return Regex.IsMatch(candidate, "^[A-Z]{3}-");
    }
}
