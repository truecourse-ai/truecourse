using System;

namespace Positive.Boundary.Security;

/// <summary>Reads the first byte of a buffer through memory-safe Span access.</summary>
public sealed class UnsafeCodeBlockSafe
{
    /// <summary>Returns the first byte, or zero when the buffer is empty.</summary>
    // SAFE: security/deterministic/unsafe-code-block
    internal int ReadFirstByte(byte[] buffer)
    {
        Span<byte> span = buffer;
        return span.IsEmpty ? 0 : span[0];
    }
}
