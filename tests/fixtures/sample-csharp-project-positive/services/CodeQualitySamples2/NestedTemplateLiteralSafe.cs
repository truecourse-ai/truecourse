namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An interpolated string whose holes reference only plain locals, with the
/// inner value lifted out beforehand, so no interpolated string is nested
/// inside another and the rule must not fire.
/// </summary>
public class NestedTemplateLiteralSafe
{
    /// <summary>Builds a greeting from a name and a pre-formatted count.</summary>
    public string Compose(string name, int count)
    {
        var countLabel = $"{count} items";
        // SAFE: code-quality/deterministic/nested-template-literal
        return $"Hello {name}, you have {countLabel}";
    }
}
