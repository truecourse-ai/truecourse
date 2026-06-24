using System.IO;

namespace Positive.Boundary.Bugs;

/// <summary>Reads a fixed-size frame header, looping until the buffer is full.</summary>
public sealed class StreamReadResultIgnoredSafe
{
    private int _framesRead;

    /// <summary>Fills the header buffer, accounting for short reads.</summary>
    internal void ReadHeader(Stream stream, byte[] header)
    {
        var offset = 0;
        while (offset < header.Length)
        {
            // SAFE: bugs/deterministic/stream-read-result-ignored
            var read = stream.Read(header, offset, header.Length - offset);
            if (read == 0)
            {
                break;
            }
            offset += read;
        }
        _framesRead++;
    }

    /// <summary>How many frame headers have been read.</summary>
    internal int FramesRead => _framesRead;
}
