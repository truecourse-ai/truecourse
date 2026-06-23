namespace Positive.Boundary.CodeQuality;

/// <summary>Holds a private field that is reassigned after construction, so it must stay mutable.</summary>
public sealed class FieldCanBeReadonlySafe
{
    // SAFE: code-quality/deterministic/field-can-be-readonly
    private int _attempts;

    /// <summary>Records one attempt and returns the running total.</summary>
    internal int Record()
    {
        _attempts += 1;
        return _attempts;
    }
}
