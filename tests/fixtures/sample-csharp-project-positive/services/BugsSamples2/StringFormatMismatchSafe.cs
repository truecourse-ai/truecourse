using System.Globalization;

namespace Positive.Boundary.Bugs;

/// <summary>Formats a progress label using exactly as many arguments as placeholders.</summary>
public sealed class StringFormatMismatchSafe
{
    /// <summary>Describes shard readiness with one argument per format placeholder.</summary>
    internal string DescribeShardProgress(int readyShards, int totalShards, int percent)
    {
        // SAFE: bugs/deterministic/string-format-mismatch
        return string.Format(CultureInfo.InvariantCulture, "{0}/{1} shards ready ({2}%)", readyShards, totalShards, percent);
    }
}
