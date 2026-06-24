namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Hosts a nested type whose name <c>Event</c> matches a VB.NET reserved keyword.
/// Because that type is <c>private</c> (not externally visible), no cross-language
/// consumer can reach it, so the rule — which only flags public/protected types —
/// must not fire.
/// </summary>
public sealed class IdentifierMatchesKeywordSafe
{
    // SAFE: code-quality/deterministic/identifier-matches-keyword
    private sealed class Event
    {
        /// <summary>The event label.</summary>
        internal string Label { get; init; } = string.Empty;
    }

    /// <summary>A default label applied when none is supplied.</summary>
    private readonly string _defaultLabel = "event";

    /// <summary>Creates a labelled internal event and returns its label.</summary>
    internal string Describe(string label)
    {
        var item = new Event { Label = string.IsNullOrEmpty(label) ? _defaultLabel : label };
        return item.Label;
    }
}
