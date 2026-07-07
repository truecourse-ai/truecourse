using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>The clock abstraction callers inject instead of reading ambient time.</summary>
public interface IClock
{
    /// <summary>The current instant.</summary>
    DateTime Now { get; }

    /// <summary>The current UTC instant.</summary>
    DateTime UtcNow { get; }
}

/// <summary>
/// The concrete clock implementation. A clock must read the ambient system time
/// somewhere; this IS the injectable abstraction the rule recommends callers use, so
/// non-testable-datetime-provider must not fire on the provider type itself.
/// </summary>
public sealed class NonTestableDateTimeProviderClockImplSafe : IClock
{
    /// <summary>The current instant, read from the system clock.</summary>
    // SAFE: code-quality/deterministic/non-testable-datetime-provider
    public DateTime Now => DateTime.Now;

    /// <summary>The current UTC instant, read from the system clock.</summary>
    // SAFE: code-quality/deterministic/non-testable-datetime-provider
    public DateTime UtcNow => DateTime.UtcNow;
}
