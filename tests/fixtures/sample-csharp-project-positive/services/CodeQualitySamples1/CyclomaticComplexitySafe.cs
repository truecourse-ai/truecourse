namespace Positive.Boundary.CodeQuality;

/// <summary>Scorer that sits exactly at the complexity ceiling of 10.</summary>
public sealed class CyclomaticComplexitySafe
{
    // SAFE: code-quality/deterministic/cyclomatic-complexity
    /// <summary>Sums weights for the nine flags; complexity is exactly 10 (max allowed).</summary>
    internal int Score(bool[] flags)
    {
        var total = 0;
        if (flags[0]) total += 1;
        if (flags[1]) total += 1;
        if (flags[2]) total += 1;
        if (flags[3]) total += 1;
        if (flags[4]) total += 1;
        if (flags[5]) total += 1;
        if (flags[6]) total += 1;
        if (flags[7]) total += 1;
        if (flags[8]) total += 1;
        return total;
    }
}
