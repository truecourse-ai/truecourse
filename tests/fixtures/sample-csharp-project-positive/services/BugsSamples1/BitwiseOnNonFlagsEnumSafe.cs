using System;

namespace Positive.Boundary.Bugs;

/// <summary>File access modes that are designed to be combined.</summary>
[Flags]
internal enum BitwiseAccessModes
{
    None = 0,
    Read = 1,
    Write = 2,
}

/// <summary>Computes access masks by combining flag members.</summary>
public sealed class BitwiseOnNonFlagsEnumSafe
{
    /// <summary>Returns the read-write mask for the access enum.</summary>
    internal BitwiseAccessModes ReadWrite()
    {
        // SAFE: bugs/deterministic/bitwise-on-non-flags-enum
        return BitwiseAccessModes.Read | BitwiseAccessModes.Write;
    }
}
