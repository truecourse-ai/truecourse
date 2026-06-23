using System;

namespace Positive.Boundary.Bugs;

/// <summary>Copies raw byte buffers using a byte-accurate count.</summary>
public sealed class BlockCopyWrongCountSafe
{
    /// <summary>Returns a copy of the source byte buffer.</summary>
    internal byte[] Clone(byte[] source)
    {
        var destination = new byte[source.Length];
        // SAFE: bugs/deterministic/blockcopy-wrong-count
        Buffer.BlockCopy(source, 0, destination, 0, source.Length);
        return destination;
    }
}
