namespace Positive.Boundary.Bugs;

/// <summary>Summarizes a retention policy from a day count.</summary>
public sealed class DuplicateBranchesSafe
{
    private const int LongRetentionDays = 90;
    private const int ShortRetentionDays = 30;

    private int _evaluations;

    /// <summary>Picks a retention policy whose branch bodies each differ.</summary>
    internal string SummarizeRetention(int days)
    {
        var policy = "none";
        // SAFE: bugs/deterministic/duplicate-branches
        if (days > LongRetentionDays)
        {
            policy = "archive";
            _evaluations++;
        }
        else if (days > ShortRetentionDays)
        {
            policy = "warm";
            _evaluations += 2;
        }
        return policy;
    }
}
