namespace ApiGatewayApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/empty-interface
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
