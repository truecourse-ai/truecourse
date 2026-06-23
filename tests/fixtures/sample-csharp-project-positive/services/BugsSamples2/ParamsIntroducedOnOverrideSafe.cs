namespace Positive.Boundary.Bugs;

/// <summary>Base batch sink that accepts a variadic set of codes.</summary>
public abstract class ParamsIntroducedOnOverrideSafeBase
{
    /// <summary>Flushes the supplied status codes.</summary>
    public abstract int Flush(params int[] codes);
}

/// <summary>Override that keeps the base's params modifier intact.</summary>
public sealed class ParamsIntroducedOnOverrideSafe : ParamsIntroducedOnOverrideSafeBase
{
    /// <summary>Flushes by summing the variadic codes.</summary>
    // SAFE: bugs/deterministic/params-introduced-on-override
    public override int Flush(params int[] codes)
    {
        var total = 0;
        foreach (var code in codes)
        {
            total += code;
        }

        return total;
    }
}
