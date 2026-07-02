namespace Positive.Boundary.Reliability;

internal interface IValueSerializer
{
    object Deserialize(string content);
}

/// <summary>
/// Reads values through an injected serializer exposed as a member named
/// <c>JsonSerializer</c>. The receiver of <c>JsonSerializer.Deserialize(...)</c>
/// is that instance member, not <c>System.Text.Json.JsonSerializer</c>, so the
/// unsafe-json-parse rule must not flag it (no BCL parse happens here).
/// </summary>
internal sealed class UnsafeJsonParseMemberShadowSafe
{
    private IValueSerializer JsonSerializer { get; }

    internal UnsafeJsonParseMemberShadowSafe(IValueSerializer jsonSerializer)
    {
        JsonSerializer = jsonSerializer;
    }

    // SAFE: reliability/deterministic/unsafe-json-parse
    internal object Read(string content)
    {
        return JsonSerializer.Deserialize(content);
    }
}
