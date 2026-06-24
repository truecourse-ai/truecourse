using System.Threading.Tasks;

namespace UserServiceApp.Violations.Bugs;

/// <summary>
/// Reads a cached value. The cache lookup returns a ValueTask that is awaited twice —
/// once to test, once to use — so the second await observes a recycled, unrelated
/// operation.
/// </summary>
internal sealed class CachedReader
{
    private readonly ICache _cache;

    public CachedReader(ICache cache) => _cache = cache;

    /// <summary>Returns the cached value for a key.</summary>
    public async Task<int> ReadAsync(string key)
    {
        var pending = _cache.GetAsync(key);
        if (await pending > 0)
        {
            // VIOLATION: bugs/deterministic/valuetask-consumed-incorrectly
            return await pending;
        }

        return 0;
    }
}

internal interface ICache
{
    /// <summary>Looks up a cached integer by key.</summary>
    ValueTask<int> GetAsync(string key);
}
