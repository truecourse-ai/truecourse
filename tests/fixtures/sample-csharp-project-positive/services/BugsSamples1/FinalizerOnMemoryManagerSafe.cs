using System;
using System.Buffers;

namespace Positive.Boundary.Bugs;

/// <summary>A MemoryManager over a fixed buffer with no finalizer, so live spans stay valid.</summary>
// SAFE: bugs/deterministic/finalizer-on-memorymanager
public sealed class FinalizerOnMemoryManagerSafe : MemoryManager<byte>
{
    private readonly byte[] _backing = new byte[256];

    /// <summary>Returns the span over the backing buffer.</summary>
    public override Span<byte> GetSpan() => _backing;

    /// <summary>Pinning is a no-op for a managed backing array.</summary>
    public override MemoryHandle Pin(int elementIndex = 0) => default;

    /// <summary>Unpinning is a no-op for a managed backing array.</summary>
    public override void Unpin()
    {
        _backing[0] = 0;
    }

    /// <summary>Clears the backing buffer when the manager is disposed.</summary>
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Array.Clear(_backing, 0, _backing.Length);
        }
    }
}
