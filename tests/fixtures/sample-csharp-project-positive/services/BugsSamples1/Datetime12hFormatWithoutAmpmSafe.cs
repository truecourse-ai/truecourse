using System;
using System.Globalization;

namespace Positive.Boundary.Bugs;

/// <summary>
/// Formats a timestamp with the 12-hour <c>hh</c> clock but includes the <c>tt</c> AM/PM
/// designator, so the rendered time is unambiguous and the rule must not fire.
/// </summary>
internal sealed class Datetime12hFormatWithoutAmpmSafe
{
    internal string FormatStartTime(DateTime startedAt)
    {
        // SAFE: bugs/deterministic/datetime-12h-format-without-ampm
        return startedAt.ToString("hh:mm tt", CultureInfo.InvariantCulture);
    }
}
