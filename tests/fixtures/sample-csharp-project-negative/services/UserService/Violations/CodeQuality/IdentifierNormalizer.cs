namespace UserServiceApp.Violations.CodeQuality;

/// <summary>Builds prefixed identifiers; one private helper ignores the receiver.</summary>
internal sealed class IdentifierNormalizer
{
    private readonly string _prefix;

    internal IdentifierNormalizer(string prefix)
    {
        _prefix = prefix;
    }

    /// <summary>Combines the instance prefix with a normalized identifier.</summary>
    internal string Build(string raw)
    {
        return _prefix + Normalize(raw);
    }

    // Takes an input, delegates only to a static helper, and never touches the
    // receiver, so it should be declared static.
    // VIOLATION: code-quality/deterministic/unused-this-parameter
    // VIOLATION: code-quality/deterministic/static-method-candidate
    private string Normalize(string raw)
    {
        return Collapse(raw);
    }

    private static string Collapse(string raw)
    {
        return raw.Trim();
    }
}
