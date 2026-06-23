using System;
using System.IO;

namespace Positive.Boundary.Reliability;

/// <summary>Owns a self-constructed stream and releases it via IDisposable.</summary>
// SAFE: reliability/deterministic/class-with-idisposable-members-not-disposable
internal sealed class ClassWithIDisposableMembersNotDisposableSafe : IDisposable
{
    private readonly MemoryStream _buffer = new();

    internal void Append(byte[] data) => _buffer.Write(data, 0, data.Length);

    /// <summary>Releases the owned buffer.</summary>
    public void Dispose() => _buffer.Dispose();
}
