using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Reads the first element of a list that has an initializer.</summary>
public sealed class EmptyCollectionAccessSafe
{
    /// <summary>Returns the leading scope from a populated list literal.</summary>
    internal string FirstScope()
    {
        // SAFE: bugs/deterministic/empty-collection-access
        return new List<string> { "read", "write" }[0];
    }
}
