namespace UserService.Violations.CodeQuality;

/// <summary>Accumulates a running total.</summary>
internal sealed class RedundantReturnAtEnd
{
    private int _total;

    /// <summary>Adds the amount to the running total.</summary>
    /// <param name="amount">The amount to add.</param>
    internal void Add(int amount)
    {
        _total += amount;
        // A bare `return;` as the last statement of a void method does nothing.
        // VIOLATION: code-quality/deterministic/redundant-jump
        return;
    }
}
