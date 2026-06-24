using System;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Decides whether a free-trial account has expired. It reads the ambient clock
/// directly, so its branch logic can't be unit-tested deterministically.
/// </summary>
internal sealed class TrialExpiryService
{
    private readonly TimeSpan _trialLength;

    public TrialExpiryService(TimeSpan trialLength)
    {
        _trialLength = trialLength;
    }

    /// <summary>True when the trial window has elapsed.</summary>
    public bool IsExpired(DateTime trialStartedUtc)
    {
        // VIOLATION: code-quality/deterministic/non-testable-datetime-provider
        var elapsed = DateTime.UtcNow - trialStartedUtc;
        return elapsed > _trialLength;
    }

    /// <summary>Days left before the trial expires.</summary>
    public int DaysRemaining(DateTime trialStartedUtc)
    {
        // VIOLATION: code-quality/deterministic/non-testable-datetime-provider
        var today = DateTime.Today;
        var deadline = trialStartedUtc.Date + _trialLength;
        return Math.Max(0, (deadline - today).Days);
    }
}
