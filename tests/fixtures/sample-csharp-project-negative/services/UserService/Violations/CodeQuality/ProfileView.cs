namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// A read model for a user's profile. The display name is surfaced through a
/// Java-style getter method rather than an idiomatic property.
/// </summary>
internal sealed class ProfileView
{
    private readonly string _displayName;

    public ProfileView(string displayName) => _displayName = displayName;

    /// <summary>The user's display name.</summary>
    // VIOLATION: code-quality/deterministic/get-method-should-be-property
    public string GetDisplayName() => _displayName;
}
