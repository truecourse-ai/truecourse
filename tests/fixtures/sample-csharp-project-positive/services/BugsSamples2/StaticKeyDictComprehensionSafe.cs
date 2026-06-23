using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Bugs;

/// <summary>Builds a lookup of topic name to its length.</summary>
public sealed class StaticKeyDictComprehensionSafe
{
    /// <summary>Maps each topic to its character length, keyed by the topic itself.</summary>
    internal Dictionary<string, int> IndexLengths(List<string> topics)
    {
        // SAFE: bugs/deterministic/static-key-dict-comprehension
        return topics.ToDictionary(topic => topic, topic => topic.Length);
    }
}
