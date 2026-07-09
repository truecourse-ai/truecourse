#nullable disable
namespace ApiGateway.Violations.Architecture;

// A pipeline stage base that declares a boundary method the host always invokes
// with a non-null argument (a pre-nullable type: nullable context disabled).
public abstract class LabelStageBase
{
    // Measures the given label; the host always passes a non-null value.
    public abstract int Measure(string label);
}

// An override cannot tighten the base method's argument contract, and the caller
// (the pipeline host) controls the argument — so a missing null-guard on an
// overridden parameter is not actionable. This must NOT be flagged (no marker):
// the line stays clean after the fix.
public sealed class LabelStage : LabelStageBase
{
    public override int Measure(string label) => label.Length;
}

// An ordinary public method that owns its own signature and dereferences a
// reference-type argument without a guard — the genuine bug this rule catches.
public sealed class LabelTruncator
{
    // VIOLATION: architecture/deterministic/missing-public-argument-validation
    public int Truncate(string label) => label.Length;
}
