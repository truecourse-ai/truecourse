using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Uses the correct `IndexOf(...) >= 0` found-check, which includes index 0.</summary>
public sealed class IndexOfPositiveCheckSafe
{
    /// <summary>Returns whether the value appears at or after the given start index.</summary>
    internal bool FoundAtOrAfter(List<string> values, string value, int startIndex)
    {
        // SAFE: bugs/deterministic/index-of-positive-check
        return values.IndexOf(value, startIndex) >= 0;
    }
}
