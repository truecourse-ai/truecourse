namespace Positive.Boundary.Bugs;

/// <summary>Formats telemetry summaries using interpolated strings with real holes.</summary>
public sealed class FstringMissingPlaceholdersSafe
{
    /// <summary>Describes a queue by tenant and depth.</summary>
    internal string DescribeQueue(string tenant, int depth)
    {
        // SAFE: bugs/deterministic/fstring-missing-placeholders
        return $"queue for {tenant} has depth {depth}";
    }
}
