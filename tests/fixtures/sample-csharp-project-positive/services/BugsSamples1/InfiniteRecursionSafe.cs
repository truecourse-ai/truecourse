namespace Positive.Boundary.Bugs;

/// <summary>Expression-bodied property that returns its backing field, not itself.</summary>
public sealed class InfiniteRecursionSafe
{
    private readonly string _regionCode;

    /// <summary>Creates the value with the given region code.</summary>
    public InfiniteRecursionSafe(string regionCode)
    {
        _regionCode = regionCode;
    }

    // SAFE: bugs/deterministic/infinite-recursion
    internal string RegionCode => _regionCode;
}
