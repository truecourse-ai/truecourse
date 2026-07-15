using System.Text.Json;

namespace UserServiceApp.Violations.Reliability;

/// <summary>Parses an untrusted request body without guarding against malformed JSON.</summary>
internal sealed class PayloadReader
{
    /// <summary>Parses the raw request body into a JSON document.</summary>
    // VIOLATION: reliability/deterministic/unsafe-json-parse
    public JsonDocument ReadBody(string body) => JsonDocument.Parse(body);
}
