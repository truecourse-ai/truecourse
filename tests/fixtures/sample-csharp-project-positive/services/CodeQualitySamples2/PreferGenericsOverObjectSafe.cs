namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An intern-style method that takes a value and returns the same value. It is
/// already generic, so the argument and result keep their concrete type and no
/// runtime cast is needed. The object-in/object-out shape the rule flags is absent.
/// </summary>
public sealed class PreferGenericsOverObjectSafe
{
    /// <summary>Returns the value passed in, preserving its type.</summary>
    // SAFE: code-quality/deterministic/prefer-generics-over-object
    public T Intern<T>(T value) => value;
}
