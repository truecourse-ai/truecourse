using System.Collections.Generic;
using Microsoft.Extensions.Logging;

namespace Demo.Caching;

/// <summary>An entity repository, used here only as a logger category.</summary>
/// <typeparam name="T">The entity type.</typeparam>
public class Repository<T>
{
    /// <summary>Gets the entity count.</summary>
    public int Count { get; init; }
}

/// <summary>Sums cache entries, logging through an injected category logger.</summary>
public class CacheReader
{
    /// <summary>Sums the values of the supplied cache pairs.</summary>
    public int SumValues(
        ILogger<Repository<string>> logger,
        IEnumerable<KeyValuePair<string, int>> pairs)
    {
        var total = 0;
        foreach (var pair in pairs)
        {
            total += pair.Value;
        }

        logger.LogDebug("summed {Total}", total);
        return total;
    }
}
