using System;

namespace Positive.Boundary.Bugs;

/// <summary>Subtracts two UTC-kind timestamps, so the operands share a timezone.</summary>
public sealed class DatetimeWithoutTimezoneSafe
{
    /// <summary>Returns how long a UTC window lasted, both ends in UTC.</summary>
    internal TimeSpan WindowDuration(DateTime startUtc, DateTime endUtc)
    {
        // SAFE: bugs/deterministic/datetime-without-timezone
        return endUtc - startUtc;
    }
}
