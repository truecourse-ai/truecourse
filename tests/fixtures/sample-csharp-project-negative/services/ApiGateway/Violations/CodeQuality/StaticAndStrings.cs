namespace ApiGatewayApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal class RouteDefaults
{
    // VIOLATION: code-quality/deterministic/static-readonly-should-be-const
    internal static readonly string Prefix = "/api";

    internal static string Qualify(string path)
    {
        return Prefix + path;
    }

    // VIOLATION: code-quality/deterministic/static-holder-type-has-constructor
    internal RouteDefaults()
    {
        // intentionally left without instance state
    }
}

internal sealed class PathJoiner
{
    internal string Combine(string[] segments)
    {
        // VIOLATION: code-quality/deterministic/use-string-concat-over-join
        return string.Join("", segments);
    }
}
