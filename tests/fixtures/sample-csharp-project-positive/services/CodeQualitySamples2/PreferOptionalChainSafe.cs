namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Guards a session before reading a boolean member. The second conjunct is a
/// plain boolean access (<c>session.IsActive</c>), not a <c>!= null</c> check,
/// so its null-conditional form would need an explicit <c>== true</c>; the rule
/// only collapses the <c>x != null &amp;&amp; x.Y != null</c> shape and skips this one.
/// </summary>
public sealed class PreferOptionalChainSafe
{
    internal bool IsLiveSession(Session session)
    {
        // SAFE: code-quality/deterministic/prefer-optional-chain
        return session != null && session.IsActive;
    }
}

/// <summary>A session with an active flag.</summary>
internal sealed class Session
{
    /// <summary>Whether the session is currently active.</summary>
    public bool IsActive { get; set; }
}
