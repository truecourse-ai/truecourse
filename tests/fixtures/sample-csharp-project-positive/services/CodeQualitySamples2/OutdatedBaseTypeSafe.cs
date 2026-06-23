using System.Collections.ObjectModel;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A collection type that derives from the modern generic
/// <c>Collection&lt;T&gt;</c> rather than the superseded non-generic
/// <c>CollectionBase</c>, so the outdated-base-type rule must not fire.
/// </summary>
// SAFE: code-quality/deterministic/outdated-base-type
public class OutdatedBaseTypeSafe : Collection<string>
{
    /// <summary>True when no items have been added yet.</summary>
    public bool IsEmpty => Count == 0;
}
