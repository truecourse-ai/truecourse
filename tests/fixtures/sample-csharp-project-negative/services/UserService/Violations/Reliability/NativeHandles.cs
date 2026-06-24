using System;
using System.Runtime.InteropServices;

namespace UserServiceApp.Violations.Reliability;

// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal sealed class NativeBuffer : IDisposable
{
    // VIOLATION: reliability/deterministic/disposable-without-finalizer
    private IntPtr _buffer;

    internal NativeBuffer(int size)
    {
        _buffer = Marshal.AllocHGlobal(size);
    }

    // VIOLATION: code-quality/deterministic/identifier-contains-type-name
    internal IntPtr Pointer => _buffer;

    /// <summary>Frees the native buffer.</summary>
    public void Dispose()
    {
        Marshal.FreeHGlobal(_buffer);
        _buffer = IntPtr.Zero;
    }
}

internal class HandleOwner : IDisposable
{
    // VIOLATION: reliability/deterministic/idisposable-pattern-incorrect
    private IntPtr _handle;

    internal HandleOwner(IntPtr handle)
    {
        _handle = handle;
    }

    internal IntPtr Handle => _handle;

    ~HandleOwner()
    {
        Marshal.FreeHGlobal(_handle);
    }

    /// <summary>Releases the handle.</summary>
    public void Dispose()
    {
        Marshal.FreeHGlobal(_handle);
        _handle = IntPtr.Zero;
    }
}
