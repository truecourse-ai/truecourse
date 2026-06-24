namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An empty public parameterless constructor that coexists with a second
/// constructor; declaring another constructor suppresses the compiler-generated
/// default, so the parameterless one is load-bearing and the rule must not fire.
/// </summary>
public class UselessConstructorSafe
{
    private readonly string _label;

    // SAFE: code-quality/deterministic/useless-constructor
    public UselessConstructorSafe()
    {
    }

    /// <summary>Creates an instance carrying the given <paramref name="label"/>.</summary>
    public UselessConstructorSafe(string label)
    {
        _label = label;
    }

    /// <summary>Returns the label, or an empty string when unset.</summary>
    public string Describe() => _label ?? string.Empty;
}
