namespace Positive.Boundary.Bugs;

/// <summary>Tracks how many retries have been attempted.</summary>
public sealed class UselessIncrementSafe
{
    private int _retryBudget;

    /// <summary>Increases the retry budget by one.</summary>
    internal void BumpRetryBudget()
    {
        // SAFE: bugs/deterministic/useless-increment
        _retryBudget++;
    }
}
