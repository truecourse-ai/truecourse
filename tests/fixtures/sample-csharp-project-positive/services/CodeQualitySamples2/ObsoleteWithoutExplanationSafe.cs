using System;
using System.Globalization;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An <c>[Obsolete]</c> attribute that carries a non-empty migration message,
/// so callers are told what to use instead and the rule must not fire.
/// </summary>
public class ObsoleteWithoutExplanationSafe
{
    // SAFE: code-quality/deterministic/obsolete-without-explanation
    [Obsolete("Use ResolveByKey instead; this lookup will be removed.")]
    internal string ResolveByName(string name) => name.Trim();

    /// <summary>The replacement key-based lookup.</summary>
    internal string ResolveByKey(int key) => key.ToString(CultureInfo.InvariantCulture);
}
