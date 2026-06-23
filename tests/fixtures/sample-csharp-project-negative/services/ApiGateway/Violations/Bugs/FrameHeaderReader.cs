using System.IO;

namespace ApiGateway.Violations.Bugs;

/// <summary>
/// Reads a fixed-size frame header from an upstream stream. It assumes Read fills the
/// buffer in a single call and ignores the returned count, so a short read on a
/// network stream leaves the header half-populated.
/// </summary>
internal sealed class FrameHeaderReader
{
    private int _framesRead;

    /// <summary>Reads the frame header into the supplied buffer.</summary>
    public void ReadHeader(Stream stream, byte[] header)
    {
        // VIOLATION: bugs/deterministic/stream-read-result-ignored
        stream.Read(header, 0, header.Length);
        _framesRead++;
    }

    /// <summary>How many frame headers have been read.</summary>
    public int FramesRead => _framesRead;
}
