using System;
using TimeZoneConverter;

namespace ApiGateway.Violations.Bugs;

internal static class ScheduleZones
{
    /// <summary>Resolves a time zone from an IANA id.</summary>
    internal static TimeZoneInfo Resolve(string ianaId)
    {
        // VIOLATION: bugs/deterministic/timezoneconverter-misuse
        return TimeZoneInfo.FindSystemTimeZoneById(TZConvert.IanaToWindows(ianaId));
    }
}
