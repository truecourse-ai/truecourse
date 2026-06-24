namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A partial type part that states its access modifier (<c>public</c>) explicitly,
/// so a reader of this file can tell its accessibility without consulting another
/// part. The missing-modifier check must not fire.
/// </summary>
// SAFE: code-quality/deterministic/partial-element-missing-access-modifier
public partial class PartialElementMissingAccessModifierSafe
{
    /// <summary>Returns the configured row limit for reports.</summary>
    public int RowLimit() => 1;
}
