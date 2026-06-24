namespace Positive.Boundary.CodeQuality;

/// <summary>A base fee schedule that subclasses can adjust.</summary>
public class FeeScheduleBase
{
    private const decimal Rate = 0.01m;

    /// <summary>The base fee for the given amount.</summary>
    public virtual decimal Fee(decimal amount) => amount * Rate;
}

/// <summary>
/// An override that calls the base member but augments its result, so it adds
/// real behaviour. The rule only flags overrides that forward to
/// <c>base.Member(sameArgs)</c> with no change, so it must not fire here.
/// </summary>
public sealed class RedundantOverrideSafe : FeeScheduleBase
{
    /// <summary>The fee for the amount, with a fixed surcharge added.</summary>
    // SAFE: code-quality/deterministic/redundant-override
    public override decimal Fee(decimal amount) => base.Fee(amount) + 1m;
}
