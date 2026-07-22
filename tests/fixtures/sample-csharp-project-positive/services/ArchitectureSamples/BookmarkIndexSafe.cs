namespace Positive.Boundary.Architecture;

/// <summary>Base type for a persistence-index row (one property per DB column).</summary>
public class MapIndex { }

/// <summary>
/// A persistence-index row: each property maps to a database column, so the link
/// column must stay a string for storage and indexing. uri-property-as-string must
/// not fire on a type deriving from an index base.
/// </summary>
public sealed class BookmarkIndexSafe : MapIndex
{
    // SAFE: architecture/deterministic/uri-property-as-string
    public string RedirectUri { get; set; }
}
