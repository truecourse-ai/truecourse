namespace ApiGateway.Violations.Style;

// The file is named PaymentRouting but the only type is RefundLedger, with no
// attribute-suffix or migration-timestamp convention to explain the difference —
// a genuine "name the file after its type" miss.
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal sealed class RefundLedger
{
}
