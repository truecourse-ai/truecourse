namespace Positive.Boundary.Bugs;

/// <summary>Drains a counter using an intentional infinite loop with a break.</summary>
public sealed class ConstantConditionSafe
{
    /// <summary>Counts down <paramref name="start"/> to zero and returns the steps taken.</summary>
    internal int Drain(int start)
    {
        var remaining = start;
        var steps = 0;
        // SAFE: bugs/deterministic/constant-condition
        while (true)
        {
            if (remaining <= 0)
            {
                break;
            }
            remaining--;
            steps++;
        }
        return steps;
    }
}
