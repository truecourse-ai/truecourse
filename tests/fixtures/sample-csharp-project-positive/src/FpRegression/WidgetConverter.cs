using System.Text.Json;
using System.Text.Json.Serialization;

namespace Demo.Serialization;

/// <summary>A value carried through a custom JSON converter.</summary>
public sealed class Widget
{
    /// <summary>The widget name.</summary>
    public string Name { get; init; }
}

/// <summary>
/// A custom System.Text.Json converter. Its Read method reads from a
/// Utf8JsonReader, where throwing JsonException on malformed input is the
/// converter contract — wrapping the parse in a try/catch would be wrong, so
/// the parse must not be flagged as an unguarded JSON parse.
/// </summary>
public sealed class WidgetConverter : JsonConverter<Widget>
{
    /// <summary>Reads a widget from the reader.</summary>
    public override Widget Read(ref Utf8JsonReader reader, System.Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var raw = document.RootElement.GetRawText();
        // SAFE: reliability/deterministic/unsafe-json-parse
        return JsonSerializer.Deserialize<Widget>(raw, options);
    }

    /// <summary>Writes a widget.</summary>
    public override void Write(Utf8JsonWriter writer, Widget value, JsonSerializerOptions options)
        => JsonSerializer.Serialize(writer, value, options);
}
