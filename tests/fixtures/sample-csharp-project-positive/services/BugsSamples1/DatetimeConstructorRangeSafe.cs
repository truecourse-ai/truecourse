using System;

namespace Positive.Boundary.Bugs;

/// <summary>
/// Constructs a DateTime whose month sits at the upper boundary (12) of its legal range,
/// so every component is in range and the rule must not fire.
/// </summary>
internal sealed class DatetimeConstructorRangeSafe
{
    // SAFE: bugs/deterministic/datetime-constructor-range
    private static readonly DateTime MaintenanceWindowStart = new DateTime(2024, 12, 31);

    internal bool IsAfterWindowStart(DateTime timestamp)
    {
        return timestamp >= MaintenanceWindowStart;
    }
}
