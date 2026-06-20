namespace ApiGateway.Violations.Security;

internal static class SharedLookupTable
{
    // VIOLATION: security/deterministic/mutable-public-static-field
    public static readonly byte[] DefaultPalette = { 0, 1, 2 };
}
