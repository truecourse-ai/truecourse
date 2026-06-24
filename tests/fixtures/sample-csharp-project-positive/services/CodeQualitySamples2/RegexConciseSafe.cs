using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Uses an explicit quantifier instead of a repeated atom, so there is nothing
/// to collapse. The concise rule only fires on three-or-more repeats of the
/// same atom or class and must not fire here.
/// </summary>
public class RegexConciseSafe
{
    /// <summary>Tests whether <paramref name="branchCode"/> is a branch code.</summary>
    public bool IsBranchCode(string branchCode)
    {
        // SAFE: code-quality/deterministic/regex-concise
        return Regex.IsMatch(branchCode, @"^\d{3}-[A-Z]+$");
    }
}
