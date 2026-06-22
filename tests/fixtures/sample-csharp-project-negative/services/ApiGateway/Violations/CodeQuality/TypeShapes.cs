namespace ApiGatewayApp.Violations.CodeQuality;

// VIOLATION: code-quality/deterministic/unnecessary-record-braces
internal record RouteKey(string Method, string Path)
{
}

// VIOLATION: code-quality/deterministic/enum-underlying-type-not-int32
internal enum BackoffKind : long
{
    None,
    Linear,
    Exponential
}

// VIOLATION: code-quality/deterministic/unsealed-attribute
[AttributeUsage(AttributeTargets.Class)]
internal class RouteTagAttribute : Attribute
{
}
