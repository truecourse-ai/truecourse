namespace ApiGatewayApp.Violations.CodeQuality;

internal class RouteDefaults
{
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
