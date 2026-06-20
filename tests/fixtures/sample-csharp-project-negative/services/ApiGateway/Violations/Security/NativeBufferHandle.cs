using System;

namespace ApiGateway.Violations.Security;

internal sealed class NativeBufferHandle
{
    // VIOLATION: security/deterministic/unmanaged-pointer-visible
    // VIOLATION: code-quality/deterministic/non-private-field
    public IntPtr Buffer;

    internal NativeBufferHandle(IntPtr buffer)
    {
        Buffer = buffer;
    }
}
