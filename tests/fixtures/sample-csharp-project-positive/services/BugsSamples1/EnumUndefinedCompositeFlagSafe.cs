using System;

namespace Positive.Boundary.Bugs;

/// <summary>Hosts a [Flags] enum whose composite member only sets bits backed by single flags.</summary>
public sealed class EnumUndefinedCompositeFlagSafe
{
    /// <summary>Permission bits that combine into composite sets.</summary>
    [Flags]
    public enum Permissions
    {
        /// <summary>No flags set.</summary>
        None = 0,

        /// <summary>Read permission.</summary>
        Read = 1,

        /// <summary>Write permission.</summary>
        Write = 2,

        /// <summary>Delete permission.</summary>
        Delete = 4,

        // SAFE: bugs/deterministic/enum-undefined-composite-flag
        All = Read | Write | Delete,
    }

    /// <summary>Returns the full permission set.</summary>
    public Permissions Everything()
    {
        return Permissions.All;
    }
}
