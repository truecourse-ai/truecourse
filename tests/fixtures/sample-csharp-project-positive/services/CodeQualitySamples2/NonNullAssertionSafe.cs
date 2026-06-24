namespace Positive.Boundary.CodeQuality;

/// <summary>
/// The non-nullable DTO bootstrap idiom: a property initialised with
/// <c>= null!</c> to satisfy the nullable checker at declaration. This is the
/// excluded form, so the null-forgiving rule must not fire.
/// </summary>
public class NonNullAssertionSafe
{
    // SAFE: code-quality/deterministic/non-null-assertion
    internal string Name { get; set; } = null!;

    /// <summary>Returns the configured name, falling back when null.</summary>
    internal string Resolve()
    {
        return Name is not null ? Name : string.Empty;
    }
}
