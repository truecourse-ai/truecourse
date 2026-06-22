namespace ApiGateway.Violations.Style;

/// <summary>An exception type missing the conventional suffix.</summary>
// VIOLATION: style/deterministic/type-name-suffix-convention
internal sealed class PaymentFailed : Exception
{
    internal PaymentFailed(string message) : base(message) { }
}
