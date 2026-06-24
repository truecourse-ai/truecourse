namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A connection that raises a present-tense <c>Closing</c> event to signal
/// imminent shutdown. The verb-tense name (CA1713) conveys ordering naturally,
/// so the rule — which only flags <c>Before</c>/<c>After</c> prefixes — is safe.
/// </summary>
public sealed class EventBeforeAfterPrefixSafe
{
    /// <summary>Raised just before the connection closes.</summary>
    // SAFE: code-quality/deterministic/event-before-after-prefix
    internal event System.EventHandler? Closing;

    /// <summary>Closes the connection, notifying subscribers first.</summary>
    internal void Close()
    {
        Closing?.Invoke(this, System.EventArgs.Empty);
    }
}
