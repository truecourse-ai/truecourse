using System;

namespace Positive.Boundary.Bugs;

/// <summary>File permission rights composed of single-bit flags.</summary>
[Flags]
internal enum FilePermissionRights
{
    None = 0,
    Read = 1,
    Write = 2,
    Execute = 4,
    // SAFE: bugs/deterministic/flags-enum-non-power-of-two
    All = Read | Write | Execute,
}

/// <summary>Exposes default permission combinations.</summary>
internal sealed class FlagsEnumNonPowerOfTwoSafe
{
    /// <summary>Returns the full permission set.</summary>
    internal FilePermissionRights Everything()
    {
        return FilePermissionRights.All;
    }
}
