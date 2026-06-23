using Newtonsoft.Json;

namespace Positive.Boundary.Security;

/// <summary>Configures Json.NET deserialization with type-name handling disabled.</summary>
public sealed class UnsafePickleUsageSafe
{
    /// <summary>Builds settings that never let payloads choose the CLR type.</summary>
    internal JsonSerializerSettings BuildSettings()
    {
        var settings = new JsonSerializerSettings();
        // SAFE: security/deterministic/unsafe-pickle-usage
        settings.TypeNameHandling = TypeNameHandling.None;
        return settings;
    }
}
