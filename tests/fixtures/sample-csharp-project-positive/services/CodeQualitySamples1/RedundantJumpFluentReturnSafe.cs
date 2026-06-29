namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A fluent options builder whose configuration methods return the builder
/// instance so calls can be chained. The trailing <c>return this;</c> is the
/// method's meaningful return value, not a redundant jump statement — removing
/// it would break the fluent API and fail to compile (the method has a return
/// type).
/// </summary>
public sealed class RedundantJumpFluentReturnSafe
{
    private int _retryCount;

    /// <summary>Sets the retry count and returns the builder for chaining.</summary>
    /// <param name="count">The number of retries to apply.</param>
    public RedundantJumpFluentReturnSafe WithRetries(int count)
    {
        _retryCount = count;
        // SAFE: code-quality/deterministic/redundant-jump
        return this;
    }

    /// <summary>Returns the configured retry count.</summary>
    public int RetryCount()
    {
        return _retryCount;
    }
}
