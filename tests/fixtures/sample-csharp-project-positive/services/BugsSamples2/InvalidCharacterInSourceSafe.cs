namespace Positive.Boundary.Bugs;

/// <summary>Resolves a cache alias from a name with only visible characters.</summary>
public sealed class InvalidCharacterInSourceSafe
{
    // SAFE: bugs/deterministic/invalid-character-in-source
    private const string LegacyCacheAlias = "cacheentry";

    /// <summary>Indicates whether the supplied name is the legacy cache alias.</summary>
    internal bool IsLegacyCacheName(string name)
    {
        return name == LegacyCacheAlias;
    }
}
