namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A parameter named <c>stringBuilder</c> — it embeds the token "String" but is not
/// exactly the type-name token, so the rule (which matches the canonical CA1720 token
/// set as a whole identifier) must not fire.
/// </summary>
public sealed class IdentifierContainsTypeNameSafe
{
    /// <summary>The separator character this instance appends.</summary>
    private readonly char _separator = ';';

    /// <summary>Appends this instance's separator using the supplied builder and returns it.</summary>
    // SAFE: code-quality/deterministic/identifier-contains-type-name
    internal System.Text.StringBuilder AppendSeparator(System.Text.StringBuilder stringBuilder)
    {
        return stringBuilder.Append(_separator);
    }
}
