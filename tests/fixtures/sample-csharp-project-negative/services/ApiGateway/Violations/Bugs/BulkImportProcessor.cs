using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

namespace ApiGateway.Violations.Bugs;

/// <summary>
/// Streams a newline-delimited import file in batches and reports how long the run
/// took. The batch size, the elapsed-time measurement, the async read loop and a
/// debug guard were each written in a hurry and carry small correctness hazards.
/// </summary>
internal sealed class BulkImportProcessor
{
    // VIOLATION: bugs/deterministic/irregular-number-pattern
    private const int BatchSize = 1_00_000;

    private int _processed;

    /// <summary>Reads every line of the import and returns how long it took, in ms.</summary>
    public async Task<double> RunAsync(StreamReader reader)
    {
        // VIOLATION: code-quality/deterministic/non-testable-datetime-provider
        var startedAt = DateTime.Now;

        // VIOLATION: bugs/deterministic/streamreader-endofstream-in-async
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync();
            Ingest(line);
        }

        // VIOLATION: bugs/deterministic/datetime-now-for-timing
        // VIOLATION: code-quality/deterministic/non-testable-datetime-provider
        return (DateTime.Now - startedAt).TotalMilliseconds;
    }

    private void Ingest(string? line)
    {
        if (string.IsNullOrEmpty(line)) return;

        // VIOLATION: bugs/deterministic/debug-assert-side-effect
        // VIOLATION: bugs/deterministic/assert-without-message
        Debug.Assert(++_processed <= BatchSize);
    }
}
