using System;

namespace Positive.Boundary.Bugs;

/// <summary>Access modes assigned distinct powers of two for bit-combining.</summary>
[Flags]
internal enum NonFlagsAccessModes
{
    None = 0,
    Read = 1,
    Write = 2,
    // SAFE: bugs/deterministic/non-flags-enum-with-flags-attribute
    ReadWrite = Read | Write,
}

/// <summary>Exposes the combined access mask.</summary>
public sealed class NonFlagsEnumWithFlagsAttributeSafe
{
    /// <summary>Returns the read-write access mask.</summary>
    internal NonFlagsAccessModes Mask()
    {
        return NonFlagsAccessModes.ReadWrite;
    }
}
