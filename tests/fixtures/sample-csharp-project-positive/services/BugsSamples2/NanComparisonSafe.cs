namespace Positive.Boundary.Bugs;

/// <summary>Detects a usable latency value using the IsNaN helper.</summary>
internal sealed class NanComparisonSafe
{
    /// <summary>Returns true when the measured latency is a real number rather than NaN.</summary>
    internal bool IsMeasured(double latencyMs)
    {
        // SAFE: bugs/deterministic/nan-comparison
        return !double.IsNaN(latencyMs);
    }
}
