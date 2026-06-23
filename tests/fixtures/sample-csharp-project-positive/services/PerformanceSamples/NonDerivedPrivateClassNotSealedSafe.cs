namespace Positive.Boundary.Performance;

/// <summary>Schedules retries using a sealed private helper.</summary>
public sealed class NonDerivedPrivateClassNotSealedSafe
{
    // SAFE: performance/deterministic/non-derived-private-class-not-sealed
    private sealed class RetrySchedule
    {
        internal int Attempts { get; init; }
    }

    /// <summary>Returns the configured attempt count for the next retry.</summary>
    internal int NextAttempts(int attempts)
    {
        var schedule = new RetrySchedule { Attempts = attempts };
        return schedule.Attempts;
    }
}
