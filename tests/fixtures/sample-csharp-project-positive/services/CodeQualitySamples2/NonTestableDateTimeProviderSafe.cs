namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Time read through an injected <see cref="System.TimeProvider"/> clock
/// abstraction rather than a direct <c>DateTime.UtcNow</c> read, so the code
/// stays deterministically testable and the rule must not fire.
/// </summary>
public class NonTestableDateTimeProviderSafe
{
    private readonly System.TimeProvider _clock;

    /// <summary>Creates the service with an injected clock.</summary>
    public NonTestableDateTimeProviderSafe(System.TimeProvider clock)
    {
        _clock = clock;
    }

    /// <summary>Returns the current instant from the injected clock.</summary>
    // SAFE: code-quality/deterministic/non-testable-datetime-provider
    internal System.DateTimeOffset CurrentInstant()
    {
        return _clock.GetUtcNow();
    }
}
