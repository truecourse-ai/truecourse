namespace ApiGateway.Violations.Performance;

internal sealed class StringOps
{
    internal bool IsAbsolute(string path)
    {
        // VIOLATION: performance/deterministic/prefer-char-startswith-endswith
        // VIOLATION: bugs/deterministic/missing-stringcomparison-overload
        // VIOLATION: performance/deterministic/prefer-char-overload
        return path.StartsWith("/");
    }
}
