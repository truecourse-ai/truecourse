namespace Positive.Boundary.Bugs;

/// <summary>Base retry policy with an optional delay knob.</summary>
internal class OptionalArgNotForwardedToBaseSafeBase
{
    /// <summary>Records an attempt using the supplied delay.</summary>
    public virtual int Attempt(int attempts, int delayMs = 100)
    {
        return delayMs * attempts;
    }
}

/// <summary>Override that correctly forwards its optional argument to the base.</summary>
internal sealed class OptionalArgNotForwardedToBaseSafe : OptionalArgNotForwardedToBaseSafeBase
{
    /// <summary>Doubles the base result while forwarding the caller's delay.</summary>
    public override int Attempt(int attempts, int delayMs = 100)
    {
        // SAFE: bugs/deterministic/optional-arg-not-forwarded-to-base
        return base.Attempt(attempts, delayMs) * 2;
    }
}
