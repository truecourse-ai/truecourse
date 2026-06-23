namespace Positive.Boundary.Bugs;

/// <summary>Holds a double-valued constant that sits exactly at the mantissa limit.</summary>
public sealed class LossOfPrecisionSafe
{
    // 2^53 is representable exactly as a double, so no precision is lost.
    // SAFE: bugs/deterministic/loss-of-precision
    private const double MaxExactInteger = 9007199254740992.0;

    /// <summary>Returns the largest integer a double can hold without rounding.</summary>
    internal double LargestExact()
    {
        return MaxExactInteger;
    }
}
