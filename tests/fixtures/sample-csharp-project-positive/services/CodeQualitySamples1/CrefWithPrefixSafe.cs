namespace Positive.Boundary.CodeQuality;

/// <summary>Boundary case for a prefix-free XML doc cref.</summary>
public sealed class CrefWithPrefixSafe
{
    // SAFE: code-quality/deterministic/cref-with-prefix
    /// <summary>Forwards to <see cref="Apply"/> so the compiler can bind it.</summary>
    internal void Forward()
    {
        Apply();
    }

    /// <summary>Records the supplied value.</summary>
    internal int Apply()
    {
        return 1;
    }
}
