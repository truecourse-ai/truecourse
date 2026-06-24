namespace ApiGatewayApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/redundant-base-type
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
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
