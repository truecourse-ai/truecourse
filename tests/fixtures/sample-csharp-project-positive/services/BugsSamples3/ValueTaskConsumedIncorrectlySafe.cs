using System.Threading.Tasks;

namespace Positive.Boundary.Bugs;

/// <summary>Reads a cached value, awaiting the lookup exactly once.</summary>
public sealed class ValueTaskConsumedIncorrectlySafe
{
    private readonly IValueCache _cache;

    /// <summary>Creates a reader over the given cache.</summary>
    public ValueTaskConsumedIncorrectlySafe(IValueCache cache) => _cache = cache;

    /// <summary>Returns the cached value for a key, awaiting the ValueTask once.</summary>
    internal async Task<int> ReadAsync(string key)
    {
        // SAFE: bugs/deterministic/valuetask-consumed-incorrectly
        var value = await _cache.GetAsync(key);
        return value * 2;
    }
}

/// <summary>A cache whose lookups return a ValueTask.</summary>
public interface IValueCache
{
    /// <summary>Looks up a cached integer by key.</summary>
    ValueTask<int> GetAsync(string key);
}
