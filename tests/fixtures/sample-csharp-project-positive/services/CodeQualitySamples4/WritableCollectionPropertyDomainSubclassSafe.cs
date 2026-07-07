using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A domain set of role names. It implements a mutable collection (via HashSet) but
/// models a single named value with its own identity, so exposing it through a
/// settable property is not the raw-collection replacement hazard CA2227 targets.
/// </summary>
public sealed class RoleSet : HashSet<string>
{
}

/// <summary>
/// Holds a default <see cref="RoleSet"/>. The property is settable because the set is
/// a domain value assigned as a unit — not a raw collection exposed for wholesale
/// replacement — so writable-collection-property must not fire on a user-defined type
/// that merely derives from a collection.
/// </summary>
public sealed class WritableCollectionPropertyDomainSubclassSafe
{
    // SAFE: code-quality/deterministic/writable-collection-property
    /// <summary>The default role set applied when none is specified.</summary>
    public RoleSet? Default { get; set; }
}
