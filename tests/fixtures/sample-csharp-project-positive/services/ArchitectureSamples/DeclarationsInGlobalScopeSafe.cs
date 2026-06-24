using System;

namespace Positive.Boundary.Architecture;

/// <summary>Holds immutable, process-wide configuration constants.</summary>
public sealed class DeclarationsInGlobalScopeSafe
{
    // SAFE: architecture/deterministic/declarations-in-global-scope
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30);

    /// <summary>Report the configured default timeout in seconds.</summary>
    public double TimeoutSeconds() => DefaultTimeout.TotalSeconds;
}
