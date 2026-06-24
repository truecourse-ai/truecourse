using System.IO;
using System.Threading.Tasks;

namespace Positive.Boundary.Performance;

/// <summary>Copies a source file to a cache path without blocking a thread.</summary>
public sealed class SyncFsInRequestHandlerSafe
{
    /// <summary>Reads and writes asynchronously so no thread-pool thread is blocked.</summary>
    internal async Task RefreshAsync(string sourcePath, string cachePath)
    {
        // SAFE: performance/deterministic/sync-fs-in-request-handler
        var payload = await File.ReadAllTextAsync(sourcePath);
        await File.WriteAllTextAsync(cachePath, payload);
    }
}
