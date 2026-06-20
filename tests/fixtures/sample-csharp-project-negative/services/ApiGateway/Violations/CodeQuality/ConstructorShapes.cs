namespace ApiGatewayApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/redundant-base-type
internal sealed class RootHandler : object
{
}

internal sealed class ForwardingHandler : RootHandler
{
    // VIOLATION: code-quality/deterministic/redundant-base-constructor-call
    internal ForwardingHandler() : base()
    {
    }
}
