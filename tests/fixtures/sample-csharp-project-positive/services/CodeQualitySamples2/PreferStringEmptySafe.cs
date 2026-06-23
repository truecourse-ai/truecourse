namespace Positive.Boundary.CodeQuality;

/// <summary>Passes an empty literal as a method argument rather than a value.</summary>
public sealed class PreferStringEmptySafe
{
    private int _calls;

    /// <summary>Wraps the value with an empty prefix and counts the call.</summary>
    internal string Wrap(string value)
    {
        _calls += 1;
        // SAFE: code-quality/deterministic/prefer-string-empty
        return Decorate(value, "");
    }

    /// <summary>The number of times <see cref="Wrap"/> has run.</summary>
    internal int Calls => _calls;

    private static string Decorate(string value, string prefix)
    {
        return prefix + value;
    }
}
