using System.Text.RegularExpressions;

namespace Positive.Boundary.Bugs;

/// <summary>
/// A regex that targets a control character via the explicit <c>\x1d</c> escape rather
/// than a raw pasted byte. The rule tests the literal's raw source text, and an escape
/// sequence is deliberate, so it must not fire.
/// </summary>
internal sealed class ControlCharsInRegexSafe
{
    // SAFE: bugs/deterministic/control-chars-in-regex
    private static readonly Regex GroupSeparatorPattern = new Regex(@"id\x1dname");

    internal bool HasGroupSeparator(string record)
    {
        return GroupSeparatorPattern.IsMatch(record);
    }
}
