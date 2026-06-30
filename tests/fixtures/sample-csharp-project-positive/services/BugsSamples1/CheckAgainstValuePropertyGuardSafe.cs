namespace Positive.Boundary.Bugs;

/// <summary>
/// Copies a title from another instance, but only when it differs. The guarded
/// member is a PROPERTY, whose setter is observable (change tracking, validation,
/// or INotifyPropertyChanged), so the `!=` guard is a deliberate optimization
/// that avoids invoking the setter when nothing changed — not a redundant no-op.
/// </summary>
public sealed class CheckAgainstValuePropertyGuardSafe
{
    /// <summary>The display title; its setter is assumed to be observable.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>Adopts the other instance's title only when it actually differs.</summary>
    public void CopyTitleFrom(CheckAgainstValuePropertyGuardSafe other)
    {
        // SAFE: bugs/deterministic/check-against-value-being-assigned
        if (Title != other.Title)
        {
            Title = other.Title;
        }
    }
}
