using System;

namespace Positive.Boundary.Reliability;

internal sealed class ProcessExitInLibrarySafe
{
    internal void AbortOnCorruptState(bool stateIsCorrupt)
    {
        if (stateIsCorrupt)
        {
            // SAFE: reliability/deterministic/process-exit-in-library
            Environment.FailFast("Unrecoverable internal state detected.");
        }
    }
}
