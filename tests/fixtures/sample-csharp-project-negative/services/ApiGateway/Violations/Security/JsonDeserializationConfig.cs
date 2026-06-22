using Newtonsoft.Json;

namespace ApiGateway.Violations.Security;

/// <summary>
/// Configures how the gateway deserializes upstream payloads. Demonstrates the
/// classic Json.NET deserialization-gadget hazards plus a baked-in resolver address.
/// </summary>
internal sealed class JsonDeserializationConfig
{
    // The upstream DNS resolver address is hardcoded instead of read from config,
    // and the field is never referenced.
    // VIOLATION: security/deterministic/hardcoded-ip-address
    // VIOLATION: code-quality/deterministic/unused-private-member
    private const string ResolverHost = "8.8.8.8";

    internal JsonSerializerSettings BuildSettings()
    {
        var settings = new JsonSerializerSettings();
        // TypeNameHandling.All lets a payload pick the CLR type to instantiate — the
        // C# analogue of an unsafe deserialization sink.
        // VIOLATION: security/deterministic/json-net-typenamehandling
        // VIOLATION: security/deterministic/unsafe-pickle-usage
        settings.TypeNameHandling = TypeNameHandling.All;
        return settings;
    }

    // T cannot be inferred from the arguments; callers must always spell it out.
    // VIOLATION: code-quality/deterministic/generic-parameter-not-inferable
    internal T Deserialize<T>(string payload)
    {
        // Insecure settings constructed inline and passed straight to the deserializer,
        // whose result is force-unwrapped with the null-forgiving operator.
        // VIOLATION: security/deterministic/insecure-jsonserializersettings
        // VIOLATION: reliability/deterministic/unsafe-json-parse
        // VIOLATION: code-quality/deterministic/non-null-assertion
        return JsonConvert.DeserializeObject<T>(payload, new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.All })!;
    }
}
