namespace ApiGatewayApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/attribute-missing-usage
internal sealed class RouteTagAttribute : Attribute
{
    public string Name { get; }

    public RouteTagAttribute(string name)
    {
        Name = name;
    }
}

// VIOLATION: code-quality/deterministic/exception-named-type-not-exception
internal class RoutingFailureException
{
    public string Reason { get; }

    public RoutingFailureException(string reason)
    {
        Reason = reason;
    }
}

// VIOLATION: code-quality/deterministic/exception-type-not-public
internal class GatewayTimeoutException : Exception
{
    public GatewayTimeoutException(string message) : base(message)
    {
    }
}
