namespace Positive.Boundary.Bugs;

/// <summary>Maps run outcomes to distinct process exit codes.</summary>
public sealed class InvariantReturnSafe
{
    // SAFE: bugs/deterministic/invariant-return
    /// <summary>Returns a distinct exit code for each outcome.</summary>
    internal int MapExitCode(bool failed, bool skipped)
    {
        if (failed)
        {
            return 1;
        }
        if (skipped)
        {
            return 2;
        }
        return 0;
    }
}
