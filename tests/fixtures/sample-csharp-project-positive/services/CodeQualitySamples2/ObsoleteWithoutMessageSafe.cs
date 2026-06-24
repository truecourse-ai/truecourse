using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An <c>[Obsolete]</c> attribute applied with a message argument, so the
/// deprecation carries migration guidance and the rule must not fire.
/// </summary>
public class ObsoleteWithoutMessageSafe
{
    // SAFE: code-quality/deterministic/obsolete-without-message
    [Obsolete("Use FetchCurrent instead.")]
    internal int FetchLegacy() => 0;

    /// <summary>The replacement accessor.</summary>
    internal int FetchCurrent() => 1;
}
