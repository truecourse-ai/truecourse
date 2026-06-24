using System;

namespace Positive.Boundary.Performance;

/// <summary>Resolves the path to the running executable.</summary>
public sealed class UseEnvironmentProcessPathSafe
{
    /// <summary>Reads the path from Environment without opening a Process handle.</summary>
    internal string? CurrentProcessPath()
    {
        // SAFE: performance/deterministic/use-environment-processpath
        return Environment.ProcessPath;
    }
}
