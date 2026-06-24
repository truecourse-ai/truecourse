namespace Positive.Boundary.Bugs;

/// <summary>Sums a small fixed range using a real loop body, not a stray semicolon.</summary>
public sealed class EmptyStatementSafe
{
    /// <summary>Returns the sum of integers from zero up to (but not including) the count.</summary>
    public int SumTo(int count)
    {
        var total = 0;
        // SAFE: bugs/deterministic/empty-statement
        for (var i = 0; i < count; i++)
        {
            total += i;
        }
        return total;
    }
}
