using Newtonsoft.Json;

namespace Positive.Boundary.Security;

/// <summary>Deserializes upstream payloads with type-name handling left disabled.</summary>
public sealed class InsecureJsonSerializerSettingsSafe
{
    /// <summary>Deserializes the payload using settings that cannot pick CLR types.</summary>
    internal object? Deserialize(string payload)
    {
        var settings = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.None };
        try
        {
            // SAFE: security/deterministic/insecure-jsonserializersettings
            return JsonConvert.DeserializeObject(payload, settings);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
