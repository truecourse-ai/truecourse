namespace Positive.Boundary.Bugs;

/// <summary>Counts down with a matching greater-than condition.</summary>
internal sealed class ForDirectionSafe
{
    /// <summary>Returns the number of descending iterations performed.</summary>
    internal int CountDown(int start)
    {
        int total = 0;
        // SAFE: bugs/deterministic/for-direction
        for (int i = start; i > 0; i--)
        {
            total++;
        }
        return total;
    }
}
