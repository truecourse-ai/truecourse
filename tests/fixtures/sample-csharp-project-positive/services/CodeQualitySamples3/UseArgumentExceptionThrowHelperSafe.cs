namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A null-or-empty string guard that already uses the dedicated
/// <c>ArgumentException.ThrowIfNullOrWhiteSpace</c> helper instead of a manual
/// <c>if (string.IsNullOrWhiteSpace(s)) throw new ArgumentException(...)</c>.
/// The rule only flags the hand-written guard, so the helper form must not fire.
/// </summary>
public sealed class UseArgumentExceptionThrowHelperSafe
{
    /// <summary>Records a display name after validating it is present.</summary>
    public string Register(string displayName)
    {
        // SAFE: code-quality/deterministic/use-argumentexception-throwhelper
        ArgumentException.ThrowIfNullOrWhiteSpace(displayName);
        return displayName.Trim();
    }
}
