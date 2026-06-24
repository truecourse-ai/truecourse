using System.Text.RegularExpressions;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A named capture group that is read back via `Groups["area"]`, so the group
/// is genuinely used. The unused-group rule must not fire.
/// </summary>
public class RegexUnusedGroupSafe
{
    private static readonly Regex PhoneMask = new Regex(@"(?<area>\d{3})-\d{4}");

    /// <summary>Returns the area-code portion of a phone number.</summary>
    public string AreaCodeOf(string phone)
    {
        // SAFE: code-quality/deterministic/regex-unused-group
        return PhoneMask.Match(phone).Groups["area"].Value;
    }
}
