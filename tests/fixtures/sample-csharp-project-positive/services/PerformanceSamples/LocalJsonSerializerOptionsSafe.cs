using System.Text.Json;

namespace Positive.Boundary.Performance;

/// <summary>Serializes payloads through a single cached options instance.</summary>
public sealed class LocalJsonSerializerOptionsSafe
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    /// <summary>Serializes using the shared, pre-built options so the metadata cache is reused.</summary>
    internal string Render(object payload)
    {
        // SAFE: performance/deterministic/local-jsonserializeroptions
        return JsonSerializer.Serialize(payload, Options);
    }
}
