namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Walks the entries of a bundle and delegates each one to a protected virtual
/// hook through the implicit receiver. The method depends on instance dispatch —
/// a subclass can override the hook — so it cannot be made static. The only
/// receiver use is an unqualified call whose argument type lives in an assembly
/// this loose-text pass does not resolve, which must still count as instance use.
/// </summary>
public class UnusedThisParameterVirtualDispatch
{
    /// <summary>Normalizes the supplied bundle by delegating to the per-entry pass.</summary>
    public void Normalize(MetadataBundle bundle)
    {
        NormalizeEntries(bundle);
    }

    /// <summary>Applies the default state to every rule carried by the bundle.</summary>
    private void NormalizeEntries(MetadataBundle bundle)
    {
        foreach (var rule in bundle.Rules)
        {
            ApplyDefault(rule);
        }
    }

    /// <summary>Overridable hook that fills in a rule's default state.</summary>
    protected virtual void ApplyDefault(ValidationRule rule)
    {
        rule.Reset();
    }
}
