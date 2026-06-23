#nullable disable
namespace ApiGateway.Violations.Architecture;

/// <summary>
/// Inspects raw request payloads. A pre-nullable type (nullable context disabled):
/// it dereferences its public arguments without guarding them, so a null from a
/// caller surfaces as an opaque NullReferenceException deep inside the method
/// instead of a clear ArgumentNullException at the boundary.
/// </summary>
public sealed class PayloadInspector
{
    // VIOLATION: architecture/deterministic/missing-public-argument-validation
    public int MeasureLength(string payload) => payload.Length;
}
