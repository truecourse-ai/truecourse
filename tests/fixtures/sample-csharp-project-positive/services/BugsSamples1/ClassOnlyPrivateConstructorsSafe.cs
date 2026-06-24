namespace Positive.Boundary.Bugs;

/// <summary>
/// Immutable token whose only constructor is private. The class is still
/// instantiable through a static factory, so the private-only constructor is
/// intentional and must not be reported as uninstantiable.
/// </summary>
public sealed class ClassOnlyPrivateConstructorsSafe
{
    private readonly string _value;

    // SAFE: bugs/deterministic/class-only-private-constructors
    private ClassOnlyPrivateConstructorsSafe(string value)
    {
        _value = value;
    }

    /// <summary>Creates a token from the given raw value.</summary>
    public static ClassOnlyPrivateConstructorsSafe Create(string value) =>
        new ClassOnlyPrivateConstructorsSafe(value);

    /// <summary>Returns the wrapped value.</summary>
    public string Reveal() => _value;
}
