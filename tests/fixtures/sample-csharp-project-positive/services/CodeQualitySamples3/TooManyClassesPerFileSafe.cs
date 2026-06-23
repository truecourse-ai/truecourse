namespace Positive.Boundary.CodeQuality;

/// <summary>Three classes plus records: the records do not count toward the per-file class limit.</summary>
public sealed class TooManyClassesPerFileSafe
{
    /// <summary>The configured retry count.</summary>
    public int Retries { get; init; }
}

// SAFE: code-quality/deterministic/too-many-classes-per-file
internal sealed class RetryPolicy
{
    internal int MaxAttempts { get; init; }
}

internal sealed class BackoffPolicy
{
    internal int BaseDelaySeconds { get; init; }
}

internal readonly record struct RetryResult(bool Succeeded, int Attempts);

internal readonly record struct BackoffResult(int DelaySeconds, int Attempt);
