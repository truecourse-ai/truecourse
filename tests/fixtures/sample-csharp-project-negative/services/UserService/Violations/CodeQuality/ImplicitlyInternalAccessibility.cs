namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// A top-level type with no explicit access modifier defaults to internal; the
/// rule asks for the accessibility to be stated. This is an ordinary type
/// declaration, not an explicit interface member, so the explicit-interface
/// exemption does not apply and the rule must still fire.
/// </summary>
// VIOLATION: code-quality/deterministic/missing-access-modifier
class ImplicitlyInternalAccessibility
{
    /// <summary>The wrapped value.</summary>
    public int Value { get; }

    /// <summary>Creates the wrapper around the supplied value.</summary>
    public ImplicitlyInternalAccessibility(int value)
    {
        Value = value;
    }
}
