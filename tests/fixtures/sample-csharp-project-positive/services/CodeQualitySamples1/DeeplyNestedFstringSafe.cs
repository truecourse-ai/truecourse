namespace Positive.Boundary.CodeQuality;

/// <summary>Single-level interpolation nesting, one level under the deep-nesting threshold.</summary>
public sealed class DeeplyNestedFstringSafe
{
    // SAFE: code-quality/deterministic/deeply-nested-fstring
    /// <summary>Composes a label with one nested interpolation spread across lines.</summary>
    internal string Compose(string shard, string node)
    {
        return $"shard {
            $"node {node}"
        } end {shard}";
    }
}
