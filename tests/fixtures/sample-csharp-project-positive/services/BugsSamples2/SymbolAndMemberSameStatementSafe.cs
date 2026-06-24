namespace Positive.Boundary.Bugs;

internal sealed class SessionLink
{
    internal SessionLink? Next { get; set; }
}

/// <summary>Updates a symbol and a member in separate statements, so neither write is ambiguous.</summary>
public sealed class SymbolAndMemberSameStatementSafe
{
    /// <summary>Detaches the head node by clearing its successor in its own statement.</summary>
    internal SessionLink Relink(SessionLink head, SessionLink replacement)
    {
        // SAFE: bugs/deterministic/symbol-and-member-same-statement
        head.Next = replacement;
        return head;
    }
}
