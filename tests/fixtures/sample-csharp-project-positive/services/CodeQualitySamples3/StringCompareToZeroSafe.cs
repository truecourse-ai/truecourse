using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An ordering comparison that compares <c>String.Compare</c> against zero with
/// <c>&lt; 0</c>, which genuinely needs the returned sign. Only <c>==</c>/<c>!=</c>
/// against zero is flagged, so the rule must not fire (CA2251).
/// </summary>
public class StringCompareToZeroSafe
{
    internal bool PrecedesAlphabetically(string a, string b)
    {
        // SAFE: code-quality/deterministic/string-compare-to-zero
        return String.Compare(a, b, StringComparison.Ordinal) < 0;
    }
}
