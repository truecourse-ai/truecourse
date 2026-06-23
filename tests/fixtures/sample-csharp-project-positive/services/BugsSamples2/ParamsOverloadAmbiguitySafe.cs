namespace Positive.Boundary.Bugs;

/// <summary>
/// Formats log messages. A fixed overload and a params overload coexist, but their
/// leading parameter types differ, so the params overload is not a type-prefix of the
/// fixed one — the bound call is unambiguous and the rule must not fire.
/// </summary>
public sealed class ParamsOverloadAmbiguitySafe
{
    private readonly string _prefix;

    /// <summary>Creates the formatter with the given prefix.</summary>
    public ParamsOverloadAmbiguitySafe(string prefix)
    {
        _prefix = prefix;
    }

    internal string Format(int code, string arg) => _prefix + code + arg;

    internal string Format(string template, params string[] args) => _prefix + template + string.Join(",", args);

    internal string Build()
    {
        // SAFE: bugs/deterministic/params-overload-ambiguity
        return Format(1, "y");
    }
}
