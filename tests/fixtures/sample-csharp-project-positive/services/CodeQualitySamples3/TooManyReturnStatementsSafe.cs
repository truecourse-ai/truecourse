namespace Positive.Boundary.CodeQuality;

/// <summary>Maps a status code to a label using exactly the allowed number of return paths.</summary>
public sealed class TooManyReturnStatementsSafe
{
    /// <summary>Returns a short label for a status bucket, with five early returns.</summary>
    internal string Label(int bucket)
    {
        // SAFE: code-quality/deterministic/too-many-return-statements
        if (bucket < 0) return "invalid";
        if (bucket == 0) return "empty";
        if (bucket == 1) return "single";
        if (bucket == 2) return "pair";
        return "many";
    }
}
