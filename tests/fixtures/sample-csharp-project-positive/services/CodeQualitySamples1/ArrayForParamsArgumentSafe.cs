namespace Positive.Boundary.CodeQuality;

/// <summary>Joins password-rule fragments via a params method.</summary>
public sealed class ArrayForParamsArgumentSafe
{
    /// <summary>Joins the given parts with a comma separator.</summary>
    internal string Join(params string[] parts)
    {
        return string.Join(", ", parts);
    }

    /// <summary>Returns the human-readable password policy summary.</summary>
    internal string Describe()
    {
        // SAFE: code-quality/deterministic/array-for-params-argument
        return Join("min length 8", "one digit", "one symbol");
    }
}
