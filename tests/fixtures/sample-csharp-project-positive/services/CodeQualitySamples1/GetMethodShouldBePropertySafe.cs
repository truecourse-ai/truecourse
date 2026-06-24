namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A public, parameterless <c>GetX()</c> that does real work rather than returning a
/// stored value. The rule only flags trivial <c>=> field</c> accessors, so a computing
/// method correctly stays a method.
/// </summary>
public sealed class GetMethodShouldBePropertySafe
{
    private readonly string _first;
    private readonly string _last;

    /// <summary>Initializes the name parts.</summary>
    public GetMethodShouldBePropertySafe(string first, string last)
    {
        _first = first;
        _last = last;
    }

    /// <summary>Composes the full name from its parts.</summary>
    // SAFE: code-quality/deterministic/get-method-should-be-property
    public string GetFullName() => string.Concat(_first, " ", _last);
}
