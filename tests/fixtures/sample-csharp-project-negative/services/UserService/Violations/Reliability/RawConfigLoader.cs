using System.Text.Json;

namespace UserServiceApp.Violations.Reliability;

internal sealed class RawConfigLoader
{
    internal RawConfig Load(string raw)
    {
        // Genuine System.Text.Json.JsonSerializer static call with no try/catch —
        // malformed input throws JsonException and crashes the caller.
        // VIOLATION: reliability/deterministic/unsafe-json-parse
        return JsonSerializer.Deserialize<RawConfig>(raw);
    }
}

internal sealed class RawConfig
{
    internal string? Name { get; init; }
}
