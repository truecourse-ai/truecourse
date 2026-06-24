namespace Positive.Boundary.Bugs;

/// <summary>Exposes constants whose digit separators group consistently.</summary>
public sealed class IrregularNumberPatternSafe
{
    // SAFE: bugs/deterministic/irregular-number-pattern
    private const long Threshold = 1_000_000;

    /// <summary>Reports whether the amount has reached the threshold.</summary>
    internal bool ReachedThreshold(long amount) => amount >= Threshold;
}
