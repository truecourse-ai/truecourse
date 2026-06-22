namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class NullCoalescing
{
    internal string Resolve(string requested, string fallback)
    {
        // VIOLATION: code-quality/deterministic/use-null-coalescing
        return requested != null ? requested : fallback;
    }

    internal string Seed(string preferred)
    {
        var host = preferred;
        // VIOLATION: code-quality/deterministic/use-null-coalescing-assignment
        if (host == null) host = "gateway.internal";

        return host;
    }
}
