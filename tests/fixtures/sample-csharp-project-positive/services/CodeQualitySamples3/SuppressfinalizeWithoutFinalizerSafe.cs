using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>Sealed disposable whose SuppressFinalize is paired with a real finalizer.</summary>
public sealed class SuppressfinalizeWithoutFinalizerSafe : IDisposable
{
    private bool _disposed;

    /// <summary>Release the handle and skip the finalizer that backs it.</summary>
    public void Dispose()
    {
        Dispose(true);
        // SAFE: code-quality/deterministic/suppressfinalize-without-finalizer
        GC.SuppressFinalize(this);
    }

    /// <summary>Unifies the finalizer and Dispose() cleanup paths.</summary>
    private void Dispose(bool disposing)
    {
        if (disposing)
        {
            _disposed = true;
        }
    }

    ~SuppressfinalizeWithoutFinalizerSafe()
    {
        Dispose(false);
    }

    /// <summary>True once the handle has been released.</summary>
    public bool IsDisposed => _disposed;
}
