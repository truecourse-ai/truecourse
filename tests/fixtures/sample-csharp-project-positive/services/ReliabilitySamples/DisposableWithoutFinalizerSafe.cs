using System;
using System.Runtime.InteropServices;

namespace Positive.Boundary.Reliability;

/// <summary>Holds an unmanaged handle and releases it via the full dispose pattern.</summary>
public sealed class DisposableWithoutFinalizerSafe : IDisposable
{
    private IntPtr _handle;
    private bool _disposed;

    /// <summary>Takes ownership of an already-allocated native handle.</summary>
    internal DisposableWithoutFinalizerSafe(IntPtr handle)
    {
        _handle = handle;
    }

    /// <summary>True while the handle is still owned by this instance.</summary>
    internal bool IsOpen => !_disposed && _handle != IntPtr.Zero;

    // SAFE: reliability/deterministic/disposable-without-finalizer
    ~DisposableWithoutFinalizerSafe()
    {
        Dispose(false);
    }

    /// <summary>Releases the native handle deterministically.</summary>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    private void Dispose(bool disposing)
    {
        if (_disposed)
        {
            return;
        }

        if (disposing)
        {
            _disposed = true;
        }

        if (_handle != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(_handle);
            _handle = IntPtr.Zero;
        }
    }
}
