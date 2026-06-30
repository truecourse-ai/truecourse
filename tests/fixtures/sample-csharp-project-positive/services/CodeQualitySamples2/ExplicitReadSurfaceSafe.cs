namespace Positive.Boundary.CodeQuality;

/// <summary>A small read surface, implemented through explicit interface members.</summary>
public interface IReadSurfaceSafe
{
    /// <summary>A caption value.</summary>
    string Caption { get; }

    /// <summary>The character at a position within the caption.</summary>
    char this[int index] { get; }
}

/// <summary>
/// Implements <see cref="IReadSurfaceSafe"/> explicitly. C# forbids an access
/// modifier on an explicit interface member (it is a compile error), so the
/// missing-access-modifier rule must not ask for one on the property or indexer.
/// </summary>
public sealed class ExplicitReadSurfaceSafe : IReadSurfaceSafe
{
    private readonly string _caption;

    /// <summary>Creates the surface over the supplied caption.</summary>
    public ExplicitReadSurfaceSafe(string caption)
    {
        _caption = caption;
    }

    // SAFE: code-quality/deterministic/missing-access-modifier
    string IReadSurfaceSafe.Caption => _caption;

    // The indexer reads through the explicitly-implemented Caption member.
    // SAFE: code-quality/deterministic/missing-access-modifier
    char IReadSurfaceSafe.this[int index] => ((IReadSurfaceSafe)this).Caption[index];
}
