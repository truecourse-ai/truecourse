namespace Positive.Boundary.Bugs;

/// <summary>Base category that every concrete catalog node extends.</summary>
public abstract class CatalogNode
{
    /// <summary>The display label for this node.</summary>
    public abstract string Label { get; }
}

/// <summary>A catalog node whose parent is another node, extending the shared base.</summary>
// SAFE: bugs/deterministic/recursive-type-inheritance
public sealed class RecursiveTypeInheritanceSafe : CatalogNode
{
    private readonly RecursiveTypeInheritanceSafe? _parent;

    /// <summary>Creates a node beneath the given parent.</summary>
    public RecursiveTypeInheritanceSafe(RecursiveTypeInheritanceSafe? parent)
    {
        _parent = parent;
    }

    /// <summary>The display label, derived from the parent depth.</summary>
    public override string Label => _parent is null ? "root" : "child";
}
