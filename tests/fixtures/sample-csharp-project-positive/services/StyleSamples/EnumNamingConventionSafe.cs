using System;

namespace Positive.Boundary.Style;

internal sealed class EnumNamingConventionSafe
{
    [Flags]
    internal enum ScopeGrants
    {
        None = 0,
        // SAFE: style/deterministic/enum-naming-convention
        ReadOnly = 1,
        Write = 2,
    }

    internal bool IsReadOnly(ScopeGrants grants) => grants == ScopeGrants.ReadOnly;
}
