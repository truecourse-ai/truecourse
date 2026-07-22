namespace UserServiceApp.Violations.Architecture;

/// <summary>A registered feed the poller fetches on a schedule.</summary>
public sealed class FeedSubscription
{
    // A URL-named property typed as a bare string on a standalone class, losing the
    // parsing and validation System.Uri would give — the rule should still flag it.
    // VIOLATION: architecture/deterministic/uri-property-as-string
    public string FeedUrl { get; set; } = string.Empty;
}
