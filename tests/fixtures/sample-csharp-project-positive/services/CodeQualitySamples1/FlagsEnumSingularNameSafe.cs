using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Holds a <c>[Flags]</c> enum that is correctly named in the plural, conveying that
/// values combine. The rule only flags singular names, so the plural form stays clean.
/// </summary>
public sealed class FlagsEnumSingularNameSafe
{
    /// <summary>Combinable access rights for a resource.</summary>
    // SAFE: code-quality/deterministic/flags-enum-singular-name
    [Flags]
    internal enum Permissions
    {
        /// <summary>No access.</summary>
        None = 0,

        /// <summary>Read access.</summary>
        Read = 1,

        /// <summary>Write access.</summary>
        Write = 2,
    }
}
