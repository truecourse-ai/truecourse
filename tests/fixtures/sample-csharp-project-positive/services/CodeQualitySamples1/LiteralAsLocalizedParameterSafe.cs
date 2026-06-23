using System.ComponentModel;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Passes a string literal to a method whose parameter is marked
/// <c>[Localizable(false)]</c>. The rule fires only when the target parameter
/// opts into localization with <c>[Localizable(true)]</c>; an explicit
/// <c>false</c> says the text is not user-facing, so it must not fire.
/// </summary>
public sealed class LiteralAsLocalizedParameterSafe
{
    private readonly IBannerSink _sink;

    /// <summary>Creates the banner over the given sink.</summary>
    public LiteralAsLocalizedParameterSafe(IBannerSink sink)
    {
        _sink = sink;
    }

    /// <summary>Records the internal diagnostic tag for a session.</summary>
    public void TagSession(string sessionId)
    {
        // SAFE: code-quality/deterministic/literal-as-localized-parameter
        Record("session-start", sessionId);
    }

    private void Record([Localizable(false)] string tag, string sessionId)
    {
        _sink.Write($"{tag}:{sessionId}");
    }
}

/// <summary>Receives banner text.</summary>
public interface IBannerSink
{
    /// <summary>Writes a line of text.</summary>
    void Write(string line);
}
