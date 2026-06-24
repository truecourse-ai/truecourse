using System;
using System.Globalization;

namespace Positive.Boundary.Bugs;

/// <summary>Parses timestamps with an explicit, culture-invariant format provider.</summary>
public sealed class DatetimeParseNoFormatProviderSafe
{
    /// <summary>Parses an ISO timestamp using the invariant culture.</summary>
    internal DateTime Parse(string text)
    {
        // SAFE: bugs/deterministic/datetime-parse-no-format-provider
        return DateTime.Parse(text, CultureInfo.InvariantCulture);
    }
}
