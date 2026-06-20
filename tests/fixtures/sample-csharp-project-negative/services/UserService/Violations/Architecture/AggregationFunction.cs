namespace UserServiceApp.Violations.Architecture;

/// <summary>Timer-triggered aggregation of sign-in counts.</summary>
internal sealed class AggregationFunction
{
    // VIOLATION: architecture/deterministic/declarations-in-global-scope
    private static long _runningTotal;

    /// <summary>Add the current window to the running total.</summary>
    // VIOLATION: architecture/deterministic/azure-function-stateful
    [FunctionName("Aggregate")]
    public void Aggregate(long windowCount)
    {
        _runningTotal += windowCount;
    }
}
