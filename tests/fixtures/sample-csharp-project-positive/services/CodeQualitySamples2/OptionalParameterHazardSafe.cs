namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An optional parameter on a non-externally-visible (internal) method. The
/// cross-assembly versioning hazard does not apply to members that cannot
/// escape the assembly, so the rule must not fire.
/// </summary>
public class OptionalParameterHazardSafe
{
    // SAFE: code-quality/deterministic/optional-parameter-hazard
    internal int Increment(int value, int step = 1) => value + step;
}
