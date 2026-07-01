namespace Positive.Boundary.Bugs;

/// <summary>
/// Guards a property assignment with an inequality check so a change-tracked entity
/// property is written only when the value actually changes. The property setter is
/// observable (it can drive change-tracking / auditing), so the guard is a deliberate
/// optimization — not a redundant no-op — and check-against-value-being-assigned must
/// not fire.
/// </summary>
public sealed class GuardedEntityPropertyAssignmentSafe
{
    /// <summary>Assigning this property marks the entity modified.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Copies the name from another record only when it differs.</summary>
    // SAFE: bugs/deterministic/check-against-value-being-assigned
    public void Patch(GuardedEntityPropertyAssignmentSafe other)
    {
        if (Name != other.Name)
        {
            Name = other.Name;
        }
    }
}
