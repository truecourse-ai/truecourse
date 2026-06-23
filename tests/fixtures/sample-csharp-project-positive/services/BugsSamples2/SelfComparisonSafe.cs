namespace Positive.Boundary.Bugs;

/// <summary>Tests for NaN using the idiomatic helper rather than a self comparison.</summary>
public sealed class SelfComparisonSafe
{
    /// <summary>Reports whether the supplied value is NaN.</summary>
    internal bool IsNotANumber(double value)
    {
        // SAFE: bugs/deterministic/self-comparison
        return double.IsNaN(value);
    }
}
