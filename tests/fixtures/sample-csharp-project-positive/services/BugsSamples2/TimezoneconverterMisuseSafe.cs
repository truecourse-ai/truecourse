using System;

namespace Positive.Boundary.Bugs;

/// <summary>Resolves a time zone passing the id straight to the framework.</summary>
public sealed class TimezoneconverterMisuseSafe
{
    /// <summary>Returns the time zone for the given IANA or Windows id.</summary>
    internal TimeZoneInfo Resolve(string timeZoneId)
    {
        // SAFE: bugs/deterministic/timezoneconverter-misuse
        return TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
    }
}
