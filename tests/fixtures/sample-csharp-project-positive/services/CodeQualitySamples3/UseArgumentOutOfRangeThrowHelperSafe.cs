namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A range guard that already uses <c>ArgumentOutOfRangeException.ThrowIfNegativeOrZero</c>
/// instead of a hand-written <c>if (n &lt; 1) throw new ArgumentOutOfRangeException(...)</c>.
/// The rule only flags the manual relational guard throwing
/// <c>ArgumentOutOfRangeException</c>, so the helper form must not fire.
/// </summary>
public sealed class UseArgumentOutOfRangeThrowHelperSafe
{
    /// <summary>Reserves the requested seat count after validating it is positive.</summary>
    public int Reserve(int seatCount)
    {
        // SAFE: code-quality/deterministic/use-argumentoutofrange-throwhelper
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(seatCount);
        return seatCount;
    }
}
