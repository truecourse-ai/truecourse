using System;

namespace Positive.Boundary.Bugs;

/// <summary>Releases a handle in a finalizer, swallowing any failure so none escapes.</summary>
public sealed class FinalizerThrowsSafe
{
    private IntPtr _handle;

    /// <summary>Records the native handle this instance owns.</summary>
    public FinalizerThrowsSafe(IntPtr handle)
    {
        _handle = handle;
    }

    private void ReleaseHandle()
    {
        if (_handle == IntPtr.Zero)
        {
            throw new InvalidOperationException("handle already released");
        }

        _handle = IntPtr.Zero;
    }

    ~FinalizerThrowsSafe()
    {
        // SAFE: bugs/deterministic/finalizer-throws
        try
        {
            ReleaseHandle();
        }
        catch (InvalidOperationException)
        {
            _handle = IntPtr.Zero;
        }
    }
}
