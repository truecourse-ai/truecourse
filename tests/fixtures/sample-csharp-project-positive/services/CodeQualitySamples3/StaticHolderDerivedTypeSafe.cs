namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Base descriptor carrying genuine instance state. Concrete descriptors derive
/// from it and are created via <c>new</c>.
/// </summary>
public class DescriptorBaseSafe
{
    /// <summary>The descriptor's display name (instance state from the base).</summary>
    public string DisplayName { get; }

    /// <summary>Creates a descriptor with the supplied display name.</summary>
    /// <param name="displayName">The display name to carry.</param>
    protected DescriptorBaseSafe(string displayName)
    {
        DisplayName = displayName;
    }
}

/// <summary>
/// A concrete descriptor. It declares only a <c>const</c> name of its own, so it
/// looks like a "static holder", but it derives from a base with instance state
/// and is instantiated through that hierarchy — its instance constructor is
/// required, not a removable static-holder artifact. (A type with a base list
/// also cannot be marked <c>static</c>.)
/// </summary>
public sealed class StaticHolderDerivedTypeSafe : DescriptorBaseSafe
{
    private const string Identifier = "console";

    /// <summary>Creates the descriptor, forwarding its identifier to the base.</summary>
    // SAFE: code-quality/deterministic/static-holder-type-has-constructor
    public StaticHolderDerivedTypeSafe() : base(Identifier)
    {
    }
}
