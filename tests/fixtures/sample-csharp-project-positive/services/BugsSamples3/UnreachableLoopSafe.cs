using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Finds the first job that is not a heartbeat, skipping heartbeats via continue.</summary>
public sealed class UnreachableLoopSafe
{
    /// <summary>A continue keeps the loop alive across iterations, so it is not unreachable.</summary>
    internal string FirstRealJob(IEnumerable<string> jobs, string heartbeat)
    {
        var result = string.Empty;
        // SAFE: bugs/deterministic/unreachable-loop
        foreach (var job in jobs)
        {
            if (job == heartbeat)
            {
                continue;
            }

            result = job;
            break;
        }
        return result;
    }
}
