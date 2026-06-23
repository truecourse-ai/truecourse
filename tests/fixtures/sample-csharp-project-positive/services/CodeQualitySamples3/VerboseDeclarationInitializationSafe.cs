using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A local whose declared type is an interface (<c>IList&lt;string&gt;</c>) of the
/// created concrete type (<c>List&lt;string&gt;</c>). The explicit type is load-bearing,
/// so neither <c>var</c> nor target-typed <c>new()</c> would convey the same thing. The
/// rule only fires when the declared type and created type are identical, so this must
/// not fire.
/// </summary>
public class VerboseDeclarationInitializationSafe
{
    /// <summary>Builds a list exposed only through its interface.</summary>
    public int Build(string first)
    {
        // SAFE: code-quality/deterministic/verbose-declaration-initialization
        IList<string> items = new List<string>();
        items.Add(first);
        return items.Count;
    }
}
