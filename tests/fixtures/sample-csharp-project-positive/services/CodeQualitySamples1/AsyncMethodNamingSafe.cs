using System.Threading.Tasks;

namespace Positive.Boundary.CodeQuality;

/// <summary>Refreshes a cache version after a short delay.</summary>
public sealed class AsyncMethodNamingSafe
{
    private int _cacheVersion;

    /// <summary>Returns the current cache version.</summary>
    internal int Version => _cacheVersion;

    /// <summary>Waits for the given delay, then bumps the cache version.</summary>
    // SAFE: code-quality/deterministic/async-method-naming
    internal async Task RefreshCacheAsync(int delayMs)
    {
        await Task.Delay(delayMs);
        _cacheVersion++;
    }
}
