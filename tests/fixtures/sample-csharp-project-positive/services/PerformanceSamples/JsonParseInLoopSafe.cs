using System.Collections.Generic;
using System.Text.Json;

namespace Positive.Boundary.Performance;

/// <summary>Deserializes a distinct manifest per entry inside the loop.</summary>
public sealed class JsonParseInLoopSafe
{
    /// <summary>Counts entries whose per-item manifest reports a stale version.</summary>
    internal int CountStale(IEnumerable<string> manifests, int minVersion)
    {
        var stale = 0;
        foreach (var manifestJson in manifests)
        {
            try
            {
                // SAFE: performance/deterministic/json-parse-in-loop
                var manifest = JsonSerializer.Deserialize<CacheManifest>(manifestJson);
                if (manifest is not null && manifest.Version < minVersion)
                {
                    stale++;
                }
            }
            catch (JsonException)
            {
                stale++;
            }
        }
        return stale;
    }
}

/// <summary>Minimal manifest payload used by the boundary case.</summary>
public sealed class CacheManifest
{
    /// <summary>Schema version carried by the manifest.</summary>
    public int Version { get; init; }
}
