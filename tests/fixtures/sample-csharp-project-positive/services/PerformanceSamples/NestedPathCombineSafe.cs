using System.IO;

namespace Positive.Boundary.Performance;

/// <summary>Builds a path from segments in a single combine call.</summary>
public sealed class NestedPathCombineSafe
{
    /// <summary>Joins all segments with one flattened Path.Combine instead of nesting calls.</summary>
    internal string ResolvePath(string root, string folder, string file)
    {
        // SAFE: performance/deterministic/nested-path-combine
        return Path.Combine(root, folder, file);
    }
}
