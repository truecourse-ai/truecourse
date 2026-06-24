using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Membership test against a populated collection — never trivially false.</summary>
public sealed class InEmptyCollectionSafe
{
    /// <summary>Returns whether the suffix is one of the known allowed values.</summary>
    internal bool IsAllowed(string suffix)
    {
        // SAFE: bugs/deterministic/in-empty-collection
        return new List<string> { ".txt", ".md", ".json" }.Contains(suffix);
    }
}
