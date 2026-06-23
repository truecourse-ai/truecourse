using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A nested type whose property name matches an INSTANCE member of the enclosing type.
/// Only static outer members are visible unqualified inside the nested type, so no
/// shadowing occurs and inner-member-shadows-outer must not fire.
/// </summary>
public class InnerMemberShadowsOuterSafe
{
    /// <summary>An instance value on the outer type; not visible unqualified inside Entry.</summary>
    public TimeSpan DefaultTtl { get; set; }

    /// <summary>A cache entry whose own DefaultTtl cannot hide a static outer member.</summary>
    internal sealed class Entry
    {
        // SAFE: code-quality/deterministic/inner-member-shadows-outer
        public TimeSpan DefaultTtl { get; set; }
    }
}
