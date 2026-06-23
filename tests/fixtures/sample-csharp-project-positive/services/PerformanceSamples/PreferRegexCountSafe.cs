using System.Text.RegularExpressions;

namespace Positive.Boundary.Performance;

/// <summary>Counts pattern matches via Regex.Count instead of Matches(...).Count.</summary>
public sealed class PreferRegexCountSafe
{
    /// <summary>Returns the number of word tokens in the text.</summary>
    internal int WordCount(string text)
    {
        // SAFE: performance/deterministic/prefer-regex-count
        return Regex.Count(text, @"\w+");
    }
}
