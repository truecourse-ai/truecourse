namespace Positive.Boundary.Bugs;

/// <summary>
/// Holds an account display name. The setter trims the incoming value and writes the
/// backing field rather than the property, so there is no setter recursion and the rule
/// must not fire.
/// </summary>
public sealed class PropertyAssignmentInOwnSetterSafe
{
    private string _displayName = string.Empty;

    /// <summary>The trimmed display name.</summary>
    public string DisplayName
    {
        get => _displayName;
        set
        {
            // SAFE: bugs/deterministic/property-assignment-in-own-setter
            _displayName = value.Trim();
        }
    }
}
