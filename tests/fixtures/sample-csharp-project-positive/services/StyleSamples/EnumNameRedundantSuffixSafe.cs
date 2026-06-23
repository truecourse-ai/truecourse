using System;

namespace Positive.Boundary.Style;

internal sealed class EnumNameRedundantSuffixSafe
{
    // SAFE: style/deterministic/enum-name-redundant-suffix
    [Flags]
    internal enum AccessRights
    {
        None = 0,
        Read = 1,
        Write = 2,
    }

    internal bool CanWrite(AccessRights rights) => rights.HasFlag(AccessRights.Write);
}
