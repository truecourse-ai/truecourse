namespace Positive.Boundary.CodeQuality;

/// <summary>Flag accumulator that stays within the branch and complexity ceilings.</summary>
public sealed class TooManyBranchesSafe
{
    /// <summary>Counts the set flags; nine if-branches keeps both branch and complexity counts at their maximums.</summary>
    internal int CountSet(bool[] flags)
    {
        var total = 0;
        // SAFE: code-quality/deterministic/too-many-branches
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
