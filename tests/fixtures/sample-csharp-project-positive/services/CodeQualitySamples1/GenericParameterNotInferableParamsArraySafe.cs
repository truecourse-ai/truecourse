namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A generic method whose type parameter appears only in a trailing
/// <c>params</c>-array parameter. The compiler still infers the type argument
/// from the supplied elements (<c>Choose(1, 2, 3)</c> infers <c>int</c>), so the
/// rule must not flag it — the parameter usage is present even though it lives in
/// the params array rather than an ordinary parameter.
/// </summary>
public sealed class GenericParameterNotInferableParamsArraySafe
{
    /// <summary>Returns the first supplied option; T is inferred from the arguments.</summary>
    // SAFE: code-quality/deterministic/generic-parameter-not-inferable
    internal T Choose<T>(params T[] options)
    {
        return options[0];
    }
}
