namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A value-like type that overrides <c>Equals(object)</c> and pairs it with a
/// consistent <c>GetHashCode()</c> override. The rule fires only when
/// <c>GetHashCode</c> is missing, so the matched pair must not fire.
/// </summary>
public sealed class EqWithoutHashSafe
{
    /// <summary>The tier code that identifies this instance.</summary>
    public string Code { get; }

    /// <summary>Creates a tier with the given code.</summary>
    public EqWithoutHashSafe(string code)
    {
        Code = code;
    }

    // SAFE: code-quality/deterministic/eq-without-hash
    /// <summary>Two tiers are equal when their codes match.</summary>
    public override bool Equals(object obj)
    {
        return obj is EqWithoutHashSafe other && other.Code == Code;
    }

    /// <summary>Hashes on the same code that <see cref="Equals"/> compares.</summary>
    public override int GetHashCode()
    {
        return Code.GetHashCode();
    }
}
