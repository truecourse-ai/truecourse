namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An unsealed class with a protected member. `protected` is meaningful here
/// because derived types can inherit it, so the sealed-class rule must not fire.
/// </summary>
public class SealedClassProtectedMemberSafe
{
    /// <summary>The maximum capacity, visible to derived types.</summary>
    // SAFE: code-quality/deterministic/sealed-class-protected-member
    protected int Capacity { get; set; }
}
