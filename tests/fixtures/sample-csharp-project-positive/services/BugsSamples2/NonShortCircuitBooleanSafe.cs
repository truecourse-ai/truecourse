namespace Positive.Boundary.Bugs;

/// <summary>Combines validation checks using short-circuiting boolean operators.</summary>
public sealed class NonShortCircuitBooleanSafe
{
    /// <summary>Returns true when the token is both present and well-formed.</summary>
    internal bool IsAcceptable(string token)
    {
        // SAFE: bugs/deterministic/non-short-circuit-boolean
        return token.Length > 0 && IsWellFormed(token);
    }

    private static bool IsWellFormed(string token)
    {
        return token.Trim().Length == token.Length;
    }
}
