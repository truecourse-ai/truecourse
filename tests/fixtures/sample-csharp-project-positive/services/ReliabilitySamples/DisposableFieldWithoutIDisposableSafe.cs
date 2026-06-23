using System;
using System.IO;

namespace Positive.Boundary.Reliability;

/// <summary>Owns a disposable field and is itself disposable, so the resource is released.</summary>
// SAFE: reliability/deterministic/disposable-field-without-idisposable
public sealed class DisposableFieldWithoutIDisposableSafe : IDisposable
{
    private readonly MemoryStream _buffer = new();

    /// <summary>Appends a byte to the buffer.</summary>
    internal void Append(byte value)
    {
        _buffer.WriteByte(value);
    }

    /// <summary>Releases the owned buffer.</summary>
    public void Dispose()
    {
        _buffer.Dispose();
    }
}
