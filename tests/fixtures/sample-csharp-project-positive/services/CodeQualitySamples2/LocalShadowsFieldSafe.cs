namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A local variable whose name matches only a <c>const</c> (implicitly static)
/// member of the type. Static members require a type-qualified access, so a bare
/// local of the same name is not a shadowing hazard and the rule must not fire
/// (it skips statics).
/// </summary>
public sealed class LocalShadowsFieldSafe
{
    private const string Region = "eu-west";

    /// <summary>Builds a routing key from the supplied tenant.</summary>
    internal string BuildKey(string tenant)
    {
        // SAFE: code-quality/deterministic/local-shadows-field
        var region = $"{Region}/{tenant}";
        return region.ToUpperInvariant();
    }
}
