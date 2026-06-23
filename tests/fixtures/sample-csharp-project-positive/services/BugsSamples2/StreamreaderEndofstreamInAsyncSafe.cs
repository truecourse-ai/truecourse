using System.IO;

namespace Positive.Boundary.Bugs;

/// <summary>Counts the lines of an import file using a synchronous reader loop.</summary>
public sealed class StreamreaderEndofstreamInAsyncSafe
{
    private int _processed;

    /// <summary>Reads every line synchronously, where polling EndOfStream is fine.</summary>
    internal int Run(StreamReader reader)
    {
        // SAFE: bugs/deterministic/streamreader-endofstream-in-async
        while (!reader.EndOfStream)
        {
            var line = reader.ReadLine();
            if (!string.IsNullOrEmpty(line))
            {
                _processed++;
            }
        }
        return _processed;
    }
}
