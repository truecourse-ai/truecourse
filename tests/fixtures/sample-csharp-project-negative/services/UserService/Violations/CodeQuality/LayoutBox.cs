namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// A view-model written in an older Java-influenced style: the width is exposed
/// through a Get/Set method pair instead of an idiomatic property.
/// </summary>
internal sealed class LayoutBox
{
    private int _width;

    /// <summary>Returns the current width.</summary>
    // VIOLATION: code-quality/deterministic/prefer-property-over-method
    public int GetWidth() => _width;

    /// <summary>Sets the width.</summary>
    public void SetWidth(int value) => _width = value;
}
