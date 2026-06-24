using System.Diagnostics;

namespace Positive.Boundary.Bugs;

/// <summary>
/// Measures elapsed time with the monotonic Stopwatch and reads TotalMilliseconds from
/// its Elapsed span rather than subtracting two DateTime.Now readings, so the rule must
/// not fire.
/// </summary>
internal sealed class DatetimeNowForTimingSafe
{
    internal double MeasureElapsed(Stopwatch watch)
    {
        // SAFE: bugs/deterministic/datetime-now-for-timing
        return watch.Elapsed.TotalMilliseconds;
    }
}
