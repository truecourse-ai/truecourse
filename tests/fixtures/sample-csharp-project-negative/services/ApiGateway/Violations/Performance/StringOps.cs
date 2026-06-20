namespace ApiGateway.Violations.Performance;

internal sealed class StringOps
{
    internal bool IsAbsolute(string path)
    {
        // VIOLATION: performance/deterministic/prefer-char-startswith-endswith
        return path.StartsWith("/");
    }
}
