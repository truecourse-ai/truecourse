namespace ApiGateway.Violations.Bugs;

internal static class SharedRegistry
{
    // VIOLATION: architecture/deterministic/declarations-in-global-scope
    // VIOLATION: code-quality/deterministic/non-private-field
    // VIOLATION: bugs/deterministic/non-constant-static-field-visible
    public static int ActiveConnections;

    internal static void Reset() => ActiveConnections = 0;
}
