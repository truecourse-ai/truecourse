using System;
using System.Threading;

namespace Positive.Boundary.Reliability;

/// <summary>Implements the full dispose pattern: finalizer and Dispose() both route through Dispose(bool).</summary>
public sealed class IDisposablePatternIncorrectSafe : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _disposed;

    /// <summary>Releases owned resources deterministically.</summary>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    // SAFE: reliability/deterministic/idisposable-pattern-incorrect
    private void Dispose(bool disposing)
    {
        if (_disposed) return;
        if (disposing)
        {
            _gate.Dispose();
        }
        _disposed = true;
    }

    ~IDisposablePatternIncorrectSafe()
    {
        Dispose(false);
    }
}
