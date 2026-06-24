using System;

namespace Positive.Boundary.Bugs;

/// <summary>Access rights for a route, declaring a named empty set.</summary>
[Flags]
internal enum RouteAccessRights
{
    // SAFE: bugs/deterministic/flags-enum-missing-zero
    None = 0,
    Read = 1,
    Write = 2,
    Execute = 4,
}

/// <summary>Holds the access-rights flags used by routing.</summary>
internal sealed class FlagsEnumMissingZeroSafe
{
    /// <summary>Returns the read-write combination of access rights.</summary>
    internal RouteAccessRights ReadWrite()
    {
        return RouteAccessRights.Read | RouteAccessRights.Write;
    }
}
