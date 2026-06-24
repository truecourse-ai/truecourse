using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Builds a set of allowed scopes with no repeated members.</summary>
public sealed class DuplicateSetValueSafe
{
    /// <summary>Returns the distinct scopes the gateway accepts.</summary>
    internal HashSet<string> AllowedScopes()
    {
        // SAFE: bugs/deterministic/duplicate-set-value
        return new HashSet<string> { "read", "write", "admin" };
    }
}
