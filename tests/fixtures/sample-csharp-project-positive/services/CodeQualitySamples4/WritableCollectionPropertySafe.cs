using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A mutable collection (<c>List&lt;string&gt;</c>) exposed through a get-only property,
/// so callers can add and remove items but cannot replace the whole collection. The rule
/// only fires when such a property also has a public setter, so this get-only shape must
/// not fire.
/// </summary>
public class WritableCollectionPropertySafe
{
    // SAFE: code-quality/deterministic/writable-collection-property
    /// <summary>The roles assigned to the user; mutable but not replaceable.</summary>
    public List<string> Roles { get; } = new();
}
