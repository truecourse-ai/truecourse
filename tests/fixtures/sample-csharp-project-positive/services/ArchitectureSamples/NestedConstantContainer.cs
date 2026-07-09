namespace Positive.Boundary.Architecture;

/// <summary>
/// A <c>public static</c> nested class whose members are all constants is an
/// intentional namespacing idiom (grouping related names under an owner), not a
/// leaked implementation helper. The nested-type-publicly-visible rule must not
/// flag such a constant container.
/// </summary>
public sealed class NestedConstantContainer
{
    /// <summary>Resolves a bundle by its declared name.</summary>
    public string Resolve(string key) => key;

    // SAFE: architecture/deterministic/nested-type-publicly-visible
    /// <summary>Standard bundle names, grouped under their owner.</summary>
    public static class StandardBundles
    {
        /// <summary>The primary bundle.</summary>
        internal const string Primary = "primary";

        /// <summary>The secondary bundle.</summary>
        internal const string Secondary = "secondary";
    }
}
