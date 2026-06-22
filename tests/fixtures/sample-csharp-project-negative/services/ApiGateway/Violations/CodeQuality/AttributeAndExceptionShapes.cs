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

    // VIOLATION: code-quality/deterministic/value-type-equals-without-operator
    internal struct RouteOffset
    {
        public override bool Equals(object obj) => obj is RouteOffset;
        public override int GetHashCode() => 0;
    }

    // VIOLATION: code-quality/deterministic/excludefromcoverage-without-justification
    [ExcludeFromCodeCoverage]
    internal string Describe()
    {
        return Reason;
    }

    // VIOLATION: code-quality/deterministic/suppression-without-justification
    [SuppressMessage("Performance", "CA1822")]
    internal string Summarize()
    {
        return "route failure: " + Reason;
    }

    // VIOLATION: code-quality/deterministic/expected-exception-attribute
    [ExpectedException(typeof(InvalidOperationException))]
    internal void RejectsInvalidRoute()
    {
        throw new InvalidOperationException(Reason);
    }
}

// VIOLATION: code-quality/deterministic/exception-type-not-public
internal class GatewayTimeoutException : Exception
{
    public GatewayTimeoutException(string message) : base(message)
    {
    }
}
