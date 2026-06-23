namespace Positive.Boundary.Performance;

/// <summary>Tests a path prefix with the early-exit StartsWith call.</summary>
public sealed class StartsWithOverIndexOfZeroSafe
{
    /// <summary>Returns true when the path is rooted at the separator.</summary>
    internal bool IsRootPath(string path)
    {
        // SAFE: performance/deterministic/startswith-over-indexof-zero
        return path.StartsWith('/');
    }
}
