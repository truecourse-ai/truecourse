namespace UserServiceApp.Violations.Architecture;

/// <summary>A user's avatar reference.</summary>
public sealed class AvatarLink
{
    // A public URL-named property typed as a bare string, losing the parsing and
    // validation System.Uri would give — the rule should flag it.
    // VIOLATION: architecture/deterministic/uri-property-as-string
    public string AvatarUrl { get; set; } = string.Empty;
}
