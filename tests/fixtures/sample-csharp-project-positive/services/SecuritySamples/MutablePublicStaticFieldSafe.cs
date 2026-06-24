using System.Collections.Immutable;

namespace Positive.Boundary.Security;

/// <summary>Exposes shared lookup data as an immutable collection rather than a mutable one.</summary>
public static class MutablePublicStaticFieldSafe
{
    // SAFE: security/deterministic/mutable-public-static-field
    public static readonly ImmutableArray<byte> DefaultPalette = ImmutableArray.Create<byte>(0, 1, 2);
}
