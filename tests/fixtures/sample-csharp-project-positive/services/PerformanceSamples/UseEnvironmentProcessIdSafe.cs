using System;

namespace Positive.Boundary.Performance;

/// <summary>Reports the current process id for diagnostic tagging.</summary>
public sealed class UseEnvironmentProcessIdSafe
{
    /// <summary>Reads the id from Environment without opening a Process handle.</summary>
    internal int CurrentProcessId()
    {
        // SAFE: performance/deterministic/use-environment-processid
        return Environment.ProcessId;
    }
}
