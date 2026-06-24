using System;

namespace Positive.Boundary.Security;

/// <summary>Holds a native buffer pointer privately behind a managed wrapper.</summary>
public sealed class UnmanagedPointerVisibleSafe
{
    // SAFE: security/deterministic/unmanaged-pointer-visible
    private readonly IntPtr _buffer;

    /// <summary>Captures the native buffer handle to wrap it safely.</summary>
    internal UnmanagedPointerVisibleSafe(IntPtr buffer)
    {
        _buffer = buffer;
    }

    /// <summary>Reports whether a non-null native buffer is held.</summary>
    internal bool HasBuffer()
    {
        return _buffer != IntPtr.Zero;
    }
}
