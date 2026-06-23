using Newtonsoft.Json;

namespace Positive.Boundary.Security;

/// <summary>Builds Json.NET settings that never let a payload pick the CLR type to create.</summary>
public sealed class JsonNetTypenamehandlingSafe
{
    /// <summary>Returns serializer settings with type-name resolution disabled.</summary>
    internal JsonSerializerSettings BuildSettings()
    {
        var settings = new JsonSerializerSettings();
        // SAFE: security/deterministic/json-net-typenamehandling
        settings.TypeNameHandling = TypeNameHandling.None;
        return settings;
    }
}
