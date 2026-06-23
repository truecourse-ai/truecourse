using System.IO;

namespace Positive.Boundary.Reliability;

/// <summary>Writes a payload through a using-scoped stream disposed exactly once.</summary>
public sealed class DoubleDisposeSafe
{
    private int _writes;

    /// <summary>Writes the payload bytes to the given path.</summary>
    internal void Write(string path, byte[] payload)
    {
        // SAFE: reliability/deterministic/double-dispose
        using var stream = File.Create(path);
        stream.Write(payload, 0, payload.Length);
        _writes++;
    }

    /// <summary>How many payloads have been written.</summary>
    internal int Writes => _writes;
}
