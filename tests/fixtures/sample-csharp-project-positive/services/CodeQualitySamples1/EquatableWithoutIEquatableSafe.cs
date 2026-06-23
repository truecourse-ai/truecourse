namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A version tag with strongly-typed equality. It exposes a
/// <c>public bool Equals(EquatableWithoutIEquatableSafe)</c> AND implements
/// <c>IEquatable&lt;T&gt;</c>, so generic collections resolve the typed method.
/// The rule only fires when the interface is missing, so this is safe.
/// </summary>
// SAFE: code-quality/deterministic/equatable-without-iequatable
public sealed class EquatableWithoutIEquatableSafe : System.IEquatable<EquatableWithoutIEquatableSafe>
{
    /// <summary>The release label this tag carries.</summary>
    public string Label { get; }

    /// <summary>Creates a tag for the given release label.</summary>
    public EquatableWithoutIEquatableSafe(string label)
    {
        Label = label;
    }

    /// <summary>Compares this tag with another by label.</summary>
    public bool Equals(EquatableWithoutIEquatableSafe? other) => other is not null && string.Equals(Label, other.Label, System.StringComparison.Ordinal);

    /// <summary>Compares this tag with another object.</summary>
    public override bool Equals(object? obj) => Equals(obj as EquatableWithoutIEquatableSafe);

    /// <summary>Returns a hash code derived from the label.</summary>
    public override int GetHashCode() => Label.GetHashCode(System.StringComparison.Ordinal);
}
