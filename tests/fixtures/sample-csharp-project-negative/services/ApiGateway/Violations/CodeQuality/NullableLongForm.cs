namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class NullableLongForm
{
    // VIOLATION: code-quality/deterministic/nullable-shorthand
    internal Nullable<int> RetryBudget { get; set; }
}
