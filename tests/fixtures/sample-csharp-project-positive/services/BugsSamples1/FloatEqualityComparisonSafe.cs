namespace Positive.Boundary.Bugs;

/// <summary>Checks a measured rate against a well-defined zero sentinel.</summary>
internal sealed class FloatEqualityComparisonSafe
{
    /// <summary>True when the supplied rate is exactly the zero sentinel.</summary>
    internal bool IsIdle(double rate)
    {
        // SAFE: bugs/deterministic/float-equality-comparison
        return rate == 0.0;
    }
}
