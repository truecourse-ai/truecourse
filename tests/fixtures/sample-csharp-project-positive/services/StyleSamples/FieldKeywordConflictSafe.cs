namespace Positive.Boundary.Style;

/// <summary>A property that keeps the name 'field' but escapes it.</summary>
internal sealed class FieldKeywordConflictSafe
{
    // SAFE: style/deterministic/field-keyword-conflict
    internal int @field { get; set; } = 1;
}
