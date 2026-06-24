using System.Text.Json;

namespace Positive.Boundary.Performance;

/// <summary>Reads an array length from JSON, disposing the document afterward.</summary>
public sealed class JsonDocumentRootElementSafe
{
    /// <summary>Returns the array length, or zero when the JSON is malformed.</summary>
    internal int ItemCount(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            // SAFE: performance/deterministic/jsondocument-rootelement
            return document.RootElement.GetArrayLength();
        }
        catch (JsonException)
        {
            return 0;
        }
    }
}
