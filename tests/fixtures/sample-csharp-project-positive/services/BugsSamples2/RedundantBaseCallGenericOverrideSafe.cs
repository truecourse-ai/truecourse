namespace Positive.Boundary.Bugs;

/// <summary>Base converter exposing an overridable generic normalization hook.</summary>
public class ConverterBase
{
    /// <summary>Normalizes a seed value; subclasses may override.</summary>
    public virtual TValue Normalize<TValue>(TValue seed)
    {
        return seed;
    }
}

/// <summary>
/// A converter that overrides the generic method and legitimately calls
/// <c>base.Normalize&lt;TValue&gt;(...)</c>. Because the type overrides
/// <c>Normalize</c>, the <c>base.</c> qualifier is required (dropping it would
/// recurse into this override), so the rule must not flag it — even though the
/// call carries an explicit type argument.
/// </summary>
public sealed class RedundantBaseCallGenericOverrideSafe : ConverterBase
{
    /// <summary>Applies the base normalization twice.</summary>
    public override TValue Normalize<TValue>(TValue seed)
    {
        // SAFE: bugs/deterministic/redundant-base-call
        var first = base.Normalize<TValue>(seed);
        return base.Normalize<TValue>(first);
    }
}
