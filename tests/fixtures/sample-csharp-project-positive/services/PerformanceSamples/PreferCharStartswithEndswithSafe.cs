using System;

namespace Positive.Boundary.Performance;

/// <summary>Suffix checks that test multi-character markers rather than single chars.</summary>
public sealed class PreferCharStartswithEndswithSafe
{
    /// <summary>True when the file name ends with the YAML extension.</summary>
    internal bool IsYaml(string fileName)
    {
        // SAFE: performance/deterministic/prefer-char-startswith-endswith
        return fileName.EndsWith(".yml", StringComparison.Ordinal);
    }
}
