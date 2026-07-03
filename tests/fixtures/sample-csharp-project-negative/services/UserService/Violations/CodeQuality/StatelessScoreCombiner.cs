namespace UserService.Violations.CodeQuality;

/// <summary>Computes weighted scores; one private helper ignores the receiver.</summary>
internal sealed class StatelessScoreCombiner
{
    private readonly int _weight;

    /// <summary>Captures the instance weight applied to scores.</summary>
    internal StatelessScoreCombiner(int weight)
    {
        _weight = weight;
    }

    /// <summary>Scales the value by the instance weight.</summary>
    internal int Weighted(int value)
    {
        return value * _weight;
    }

    /// <summary>Drives the stateless helper for a pair of inputs.</summary>
    internal int Total(int a, int b)
    {
        return Combine(a, b);
    }

    // Takes inputs, delegates only to a static helper, and never touches the
    // receiver, so it should be declared static.
    // VIOLATION: code-quality/deterministic/unused-this-parameter
    // VIOLATION: code-quality/deterministic/static-method-candidate
    private int Combine(int a, int b)
    {
        return Twice(a) + Twice(b);
    }

    private static int Twice(int n)
    {
        return n * 2;
    }
}
