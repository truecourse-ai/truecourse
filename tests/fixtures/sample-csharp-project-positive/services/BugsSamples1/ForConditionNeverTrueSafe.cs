namespace Positive.Boundary.Bugs;

/// <summary>Runs a constant-bounded loop whose condition is true at entry.</summary>
internal sealed class ForConditionNeverTrueSafe
{
    /// <summary>Returns the number of iterations the loop performs.</summary>
    internal int Iterations()
    {
        int total = 0;
        // SAFE: bugs/deterministic/for-condition-never-true
        for (int i = 0; i < 2; i++)
        {
            total++;
        }
        return total;
    }
}
