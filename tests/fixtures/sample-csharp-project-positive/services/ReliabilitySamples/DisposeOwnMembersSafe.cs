using System;
using System.IO;

namespace Positive.Boundary.Reliability;

/// <summary>Owns a disposable field and releases it from Dispose().</summary>
public sealed class DisposeOwnMembersSafe : IDisposable
{
    private readonly MemoryStream _stream = new();

    /// <summary>Writes one byte into the owned stream.</summary>
    internal void Write(byte value)
    {
        _stream.WriteByte(value);
    }

    /// <summary>Disposes the owned stream.</summary>
    public void Dispose()
    {
        // SAFE: reliability/deterministic/dispose-own-members
        _stream.Dispose();
    }
}
