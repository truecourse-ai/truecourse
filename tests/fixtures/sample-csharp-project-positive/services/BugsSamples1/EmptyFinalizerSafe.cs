using System;

namespace Positive.Boundary.Bugs;

/// <summary>Holds an unmanaged handle and frees it in a real finalizer body.</summary>
public sealed class EmptyFinalizerSafe
{
    private IntPtr _handle;
    private bool _released;

    /// <summary>Records the native handle this instance owns.</summary>
    public EmptyFinalizerSafe(IntPtr handle)
    {
        _handle = handle;
    }

    /// <summary>Returns whether the owned handle has already been released.</summary>
    public bool IsReleased => _released && _handle == IntPtr.Zero;

    // SAFE: bugs/deterministic/empty-finalizer
    ~EmptyFinalizerSafe()
    {
        _handle = IntPtr.Zero;
        _released = true;
    }
}
