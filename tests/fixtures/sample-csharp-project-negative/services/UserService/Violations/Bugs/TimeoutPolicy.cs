namespace UserServiceApp.Violations.Bugs;

/// <summary>
/// Applies request-timeout policy. A refactor left the incoming timeout being
/// overwritten by the configured cap before it is ever used, so the caller's
/// requested value is silently discarded.
/// </summary>
internal sealed class TimeoutPolicy
{
    private readonly int _maxSeconds;

    public TimeoutPolicy(int maxSeconds) => _maxSeconds = maxSeconds;

    /// <summary>Resolves the effective timeout in seconds.</summary>
    public int Resolve(int requestedSeconds)
    {
        // VIOLATION: bugs/deterministic/initial-value-overwritten
        // VIOLATION: code-quality/deterministic/parameter-reassignment
        requestedSeconds = _maxSeconds;
        return requestedSeconds;
    }
}
