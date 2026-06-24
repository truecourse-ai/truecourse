using System.IO;

namespace ApiGateway.Violations.Reliability;

/// <summary>
/// Writes a payload to a temp file. The stream is held by a using AND disposed
/// explicitly in a misguided attempt to release it early — a double dispose.
/// </summary>
internal sealed class PayloadWriter
{
    private int _writes;

    /// <summary>Writes the payload bytes to the given path.</summary>
    public void Write(string path, byte[] payload)
    {
        using var stream = File.Create(path);
        stream.Write(payload, 0, payload.Length);
        // VIOLATION: reliability/deterministic/double-dispose
        stream.Dispose();
        _writes++;
    }

    /// <summary>How many payloads have been written.</summary>
    public int Writes => _writes;
}
