namespace ApiGatewayApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/empty-interface
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal interface IRoutingTag
{
}

internal enum RetryMode
{
    // VIOLATION: code-quality/deterministic/enum-member-prefixed-with-type
    RetryModeNone,
    Linear,
    Exponential,
    // VIOLATION: code-quality/deterministic/enum-reserved-member-name
    Reserved
}
